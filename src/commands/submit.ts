/**
 * Submit command - Create/update PRs for the stack
 */

import type { ArgumentsCamelCase } from "yargs";
import { buildStack, generatePRBody, generateStackBranchName, extractStackName } from "../core/stack";
import { validatePrerequisites } from "../core/validate";
import {
  createPR,
  updatePR,
  findPRByBranch,
  getPR,
} from "../core/github";
import {
  createBranch,
  pushBranch,
  getCurrentBranch,
  getCommitMessage,
  amendCommitMessage,
  checkout,
  getSha,
  getCommitsInRange,
  getMergeBase,
  parseCommit,
  deleteLocalBranch,
  getRemoteBranchSha,
} from "../core/git";
import { setTrailers, TRAILER_KEYS, getStackerTrailers } from "../utils/trailers";
import { handleError } from "../utils/error-handler";
import { logger } from "../utils/logger";
import { loadConfig } from "../core/config";
import { execStdout } from "../utils/exec";

export async function submitCommand(argv: ArgumentsCamelCase): Promise<void> {
  const opts = argv as unknown as {
    remote: string;
    base?: string;
    head: string;
    target: string;
    verbose: boolean;
    draft: boolean;
    reviewer?: string;
    keepBody: boolean;
    updateTitle: boolean;
    repair: boolean;
  };

  const { remote, base, head, target, verbose, draft, reviewer, keepBody, updateTitle, repair } = opts;

  try {
    // Validate prerequisites
    await validatePrerequisites({
      requireGitRepo: true,
      requireCommits: true,
      requireRemote: remote,
      requireGh: true,
    });

    const config = await loadConfig();
    const reviewers = reviewer
      ? reviewer.split(",").map((r) => r.trim())
      : config.repo.reviewers;

    // Build the stack
    logger.info("Building stack...");
    const stack = await buildStack({ base, head, target, remote });

    if (stack.entries.length === 0) {
      logger.warn("No commits found in stack range");
      return;
    }

    logger.info(`Found ${stack.entries.length} commits in stack`);

    if (stack.dependsOn) {
      logger.info(`Depends on stack: ${stack.dependsOn.stackName}`);
    }

    // Save current branch to return to later
    const originalBranch = await getCurrentBranch();

    try {
      // Phase 1: Look up existing PR numbers and prepare trailer data
      // We need PR numbers before we can add trailers to commits
      const prNumbers: (number | undefined)[] = [];
      
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        let prNumber = entry.prNumber;
        if (!prNumber) {
          const foundPr = await findPRByBranch(entry.branchName);
          prNumber = foundPr ?? undefined;
        }
        
        // If repair mode is enabled, check if the PR is closed and skip it
        if (repair && prNumber) {
          try {
            const pr = await getPR(prNumber);
            if (pr.state === "CLOSED") {
              logger.info(`PR #${prNumber} is closed, will create new PR (--repair)`);
              prNumber = undefined;
            }
          } catch {
            // PR not found or error, treat as no PR
            prNumber = undefined;
          }
        }
        
        prNumbers[i] = prNumber;
      }

      // Phase 2: Use interactive rebase to add trailers to all commits
      // This ensures parent-child relationships are preserved
      logger.info("Adding trailers to commits...");
      
      const mergeBase = await getMergeBase(head, `${remote}/${target}`);
      
      // Check if any commits need trailer updates
      let needsRebase = false;
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        const existingTrailers = getStackerTrailers(entry.commit.body);
        const existingPr = existingTrailers.get(TRAILER_KEYS.PR);
        const existingBranch = existingTrailers.get(TRAILER_KEYS.BRANCH);
        
        // Need to update if PR number changed or branch name changed
        if (existingPr !== String(prNumbers[i] ?? '') || existingBranch !== entry.branchName) {
          needsRebase = true;
          break;
        }
      }

      if (needsRebase) {
        // Perform interactive rebase to add trailers
        await rebaseWithTrailers(
          mergeBase,
          stack.entries.map((e, i) => ({
            sha: e.commit.sha,
            branchName: e.branchName,
            prNumber: prNumbers[i],
            dependsOn: i === 0 ? stack.dependsOn?.stackName : undefined,
          })),
          verbose
        );
        
        // Re-read commits after rebase to get new SHAs
        const newCommits = await getCommitsInRange(mergeBase, "HEAD");
        for (let i = 0; i < stack.entries.length; i++) {
          if (newCommits[i]) {
            stack.entries[i]!.commit = newCommits[i]!;
          }
        }
      }

      // Phase 3: Create branches at each commit and push
      // Now that commits have trailers with correct parent relationships,
      // we can safely create branches
      logger.info("Creating and pushing branches...");
      
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        logger.info(
          `Processing ${i + 1}/${stack.entries.length}: ${entry.commit.shortSha} - ${entry.commit.subject}`
        );

        // Check if remote branch already has the same commit
        // Compare full commit SHAs to ensure parent relationships are correct for stacked PRs
        const remoteCommitSha = await getRemoteBranchSha(remote, entry.branchName);
        const needsPush = remoteCommitSha !== entry.commit.sha;

        if (needsPush) {
          // Create/update the branch at this commit
          logger.debug(`Creating branch ${entry.branchName}`, verbose);
          await createBranch(entry.branchName, entry.commit.sha);

          // Push the branch
          logger.debug(`Pushing branch ${entry.branchName}`, verbose);
          await pushBranch(remote, entry.branchName, true);
        } else {
          logger.debug(`Branch ${entry.branchName} is up-to-date, skipping push`, verbose);
        }
      }

      // Phase 4: Create/update PRs
      logger.info("Creating/updating PRs...");
      
      let newPrsCreated = false;
      
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        let prNumber = prNumbers[i];

        if (prNumber) {
          // Update existing PR
          logger.debug(`Updating PR #${prNumber}`, verbose);

          let body: string | undefined;
          if (!keepBody) {
            const existingPR = await getPR(prNumber);
            body = generatePRBody(stack, i, existingPR.body);
          }

          await updatePR({
            number: prNumber,
            base: entry.targetBranch,
            body,
            title: updateTitle ? entry.commit.subject : undefined,
          });

          entry.prNumber = prNumber;
          logger.success(`Updated PR #${prNumber}`);
        } else {
          // Create new PR
          logger.debug(`Creating new PR for ${entry.branchName}`, verbose);

          const body = generatePRBody(stack, i);

          prNumber = await createPR({
            head: entry.branchName,
            base: entry.targetBranch,
            title: entry.commit.subject,
            body,
            draft,
            reviewers,
          });

          entry.prNumber = prNumber;
          prNumbers[i] = prNumber;
          newPrsCreated = true;
          logger.success(`Created PR #${prNumber}`);
        }
      }

      // Phase 5: If we created new PRs, we need to update trailers with PR numbers
      // and re-push, then update PR bodies with cross-links
      
      if (newPrsCreated) {
        logger.info("Updating commits with new PR numbers...");
        
        await rebaseWithTrailers(
          mergeBase,
          stack.entries.map((e, i) => ({
            sha: e.commit.sha,
            branchName: e.branchName,
            prNumber: e.prNumber,
            dependsOn: i === 0 ? stack.dependsOn?.stackName : undefined,
          })),
          verbose
        );
        
        // Re-read commits and update branches
        const newCommits = await getCommitsInRange(mergeBase, "HEAD");
        for (let i = 0; i < stack.entries.length; i++) {
          if (newCommits[i]) {
            stack.entries[i]!.commit = newCommits[i]!;
            
            // Check if push is needed (compare commit SHAs for correct parent chain)
            const remoteCommitSha = await getRemoteBranchSha(remote, stack.entries[i]!.branchName);
            
            if (remoteCommitSha !== newCommits[i]!.sha) {
              await createBranch(stack.entries[i]!.branchName, newCommits[i]!.sha);
              await pushBranch(remote, stack.entries[i]!.branchName, true);
            }
          }
        }
      }

      // Phase 6: Update all PR bodies with final cross-links
      logger.info("Updating PR cross-links...");
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        if (entry.prNumber && !keepBody) {
          const body = generatePRBody(stack, i);
          await updatePR({ number: entry.prNumber, body });
        }
      }

      logger.success(`Successfully submitted ${stack.entries.length} PRs!`);

      // Print summary
      logger.blank();
      logger.header("Stack:");
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        const prRef = logger.pr(entry.prNumber);
        const sha = logger.sha(entry.commit.sha);
        console.log(`  ${i + 1}. ${prRef} ${sha} - ${entry.commit.subject}`);
      }

      // Cleanup: Delete local stack branches (they're only needed for pushing)
      for (const entry of stack.entries) {
        await deleteLocalBranch(entry.branchName);
      }
    } finally {
      // Return to original branch
      await checkout(originalBranch);
    }
  } catch (error) {
    handleError(error, verbose);
  }
}

/**
 * Perform an interactive rebase to add/update trailers on commits
 * This preserves parent-child relationships between commits
 */
async function rebaseWithTrailers(
  base: string,
  commits: Array<{
    sha: string;
    branchName: string;
    prNumber: number | undefined;
    dependsOn: string | undefined;
  }>,
  verbose: boolean
): Promise<void> {
  // Create a script that will be used as GIT_SEQUENCE_EDITOR
  // to set up the rebase, and EDITOR to update commit messages
  
  // We'll use 'reword' for each commit and provide the new messages
  const todoLines = commits.map((c) => `reword ${c.sha}`).join("\n");
  
  // Create temp files for the todo list and commit messages
  const timestamp = Date.now();
  const todoFile = `/tmp/stacker-todo-${timestamp}`;
  const messagesDir = `/tmp/stacker-messages-${timestamp}`;
  
  await Bun.write(todoFile, todoLines + "\n");
  await execStdout(`mkdir -p ${messagesDir}`);
  
  // Pre-compute and write all the new commit messages
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i]!;
    const originalMessage = await getCommitMessage(c.sha);
    
    const trailers = new Map<string, string>([
      [TRAILER_KEYS.BRANCH, c.branchName],
    ]);
    
    if (c.prNumber) {
      trailers.set(TRAILER_KEYS.PR, String(c.prNumber));
    }
    
    if (c.dependsOn) {
      trailers.set(TRAILER_KEYS.DEPENDS_ON, c.dependsOn);
    }
    
    const newMessage = setTrailers(originalMessage, trailers);
    await Bun.write(`${messagesDir}/${i}`, newMessage);
  }
  
  // Create the editor script that will pick the right message file
  // based on the commit being edited (using a counter file)
  const editorScript = `/tmp/stacker-editor-${timestamp}.sh`;
  const counterFile = `/tmp/stacker-counter-${timestamp}`;
  
  await Bun.write(counterFile, "0");
  
  const editorContent = `#!/bin/bash
COUNTER_FILE="${counterFile}"
MESSAGES_DIR="${messagesDir}"
COUNT=$(cat "$COUNTER_FILE")
cat "$MESSAGES_DIR/$COUNT" > "$1"
echo $((COUNT + 1)) > "$COUNTER_FILE"
`;
  
  await Bun.write(editorScript, editorContent);
  await execStdout(`chmod +x ${editorScript}`);
  
  try {
    // Run the rebase with our custom editors
    const { exec } = await import("../utils/exec");
    await exec(`git rebase -i ${base}`, {
      env: {
        GIT_SEQUENCE_EDITOR: `cat "${todoFile}" >`,
        GIT_EDITOR: editorScript,
        EDITOR: editorScript,
      },
    });
  } finally {
    // Cleanup temp files
    try {
      await execStdout(`rm -rf "${todoFile}" "${messagesDir}" "${editorScript}" "${counterFile}"`);
    } catch {
      // Ignore cleanup errors
    }
  }
}
