/**
 * Submit command - Create/update PRs for the stack
 */

import type { ArgumentsCamelCase } from "yargs";
import { buildStack, generatePRBody } from "../core/stack";
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
} from "../core/git";
import { setTrailers, TRAILER_KEYS } from "../utils/trailers";
import { handleError } from "../utils/error-handler";
import { logger } from "../utils/logger";
import { loadConfig } from "../core/config";

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
  };

  const { remote, base, head, target, verbose, draft, reviewer, keepBody } = opts;

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
    const originalSha = await getSha("HEAD");

    try {
      // Process each commit in the stack
      for (let i = 0; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        logger.info(
          `Processing ${i + 1}/${stack.entries.length}: ${entry.commit.shortSha} - ${entry.commit.subject}`
        );

        // Create/update the branch at this commit
        logger.debug(`Creating branch ${entry.branchName}`, verbose);
        await createBranch(entry.branchName, entry.commit.sha);

        // Push the branch
        logger.debug(`Pushing branch ${entry.branchName}`, verbose);
        await pushBranch(remote, entry.branchName, true);

        // Check if PR exists
        let prNumber = entry.prNumber;
        if (!prNumber) {
          const foundPr = await findPRByBranch(entry.branchName);
          prNumber = foundPr ?? undefined;
        }

        if (prNumber) {
          // Update existing PR
          logger.debug(`Updating PR #${prNumber}`, verbose);

          let body: string | undefined;
          if (!keepBody) {
            // Generate new body with cross-links
            const existingPR = await getPR(prNumber);
            body = generatePRBody(stack, i, existingPR.body);
          }

          await updatePR({
            number: prNumber,
            base: entry.targetBranch,
            body,
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
          logger.success(`Created PR #${prNumber}`);
        }

        // Update commit with trailers
        // This is tricky because we need to amend the commit
        // For now, we'll update the trailers on the branch
        await checkout(entry.branchName);
        const currentMessage = await getCommitMessage("HEAD");
        const trailers = new Map<string, string>([
          [TRAILER_KEYS.BRANCH, entry.branchName],
          [TRAILER_KEYS.PR, String(prNumber)],
        ]);

        if (stack.dependsOn && i === 0) {
          trailers.set(TRAILER_KEYS.DEPENDS_ON, stack.dependsOn.stackName);
        }

        const newMessage = setTrailers(currentMessage, trailers);
        if (newMessage !== currentMessage) {
          await amendCommitMessage(newMessage);
          // Re-push with updated commit
          await pushBranch(remote, entry.branchName, true);
        }
      }

      // Update all PR bodies with final cross-links (now that we have all PR numbers)
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
    } finally {
      // Return to original branch
      await checkout(originalBranch);
    }
  } catch (error) {
    handleError(error, verbose);
  }
}
