/**
 * Land command - Merge bottom PR and rebase rest
 */

import type { ArgumentsCamelCase } from "yargs";
import { buildStack, findDependentStacks } from "../core/stack";
import { validatePrerequisites } from "../core/validate";
import {
  getPRStatus,
  mergePR,
  updatePR,
  areCIChecksPassing,
} from "../core/github";
import {
  checkout,
  fetch,
  rebaseOnto,
  getCommitMessage,
  getCurrentBranch,
} from "../core/git";
import { stripStackerTrailers } from "../utils/trailers";
import { exec } from "../utils/exec";
import { handleError } from "../utils/error-handler";
import {
  NoPRForCommitError,
  PRNotMergeableError,
  ChangesRequestedError,
  ReviewRequiredError,
  CIFailedError,
  CIPendingError,
  RebaseConflictError,
} from "../utils/errors";
import { logger } from "../utils/logger";

export async function landCommand(argv: ArgumentsCamelCase): Promise<void> {
  const opts = argv as unknown as {
    remote: string;
    base?: string;
    head: string;
    target: string;
    verbose: boolean;
    all?: boolean;
    dryRun?: boolean;
    force?: boolean;
  };

  const {
    remote,
    base,
    head,
    target,
    verbose = false,
    all,
    dryRun,
    force,
  } = opts;

  try {
    // Validate prerequisites
    await validatePrerequisites({
      requireGitRepo: true,
      requireCommits: true,
      requireRemote: remote,
      requireGh: true,
    });

    // Build the stack
    logger.info("Building stack...");
    const stack = await buildStack({ base, head, target, remote });

    if (stack.entries.length === 0) {
      logger.warn("No PRs in stack to land");
      return;
    }

    // Get bottom-most PR
    const bottomEntry = stack.entries[0]!;

    if (!bottomEntry.prNumber) {
      throw new NoPRForCommitError(bottomEntry.commit.sha);
    }

    // === PRE-MERGE VALIDATION ===
    logger.info(`Checking PR #${bottomEntry.prNumber}...`);
    const status = await getPRStatus(bottomEntry.prNumber);

    if (dryRun) {
      logger.header("Dry Run - Would land:");
      console.log(
        `  PR #${bottomEntry.prNumber}: ${bottomEntry.commit.subject}`
      );
      console.log(`  Mergeable: ${status.mergeable}`);
      console.log(`  Review: ${status.reviewDecision ?? "none"}`);
      console.log(`  State: ${status.mergeStateStatus}`);

      const ciStatus = await areCIChecksPassing(bottomEntry.prNumber);
      console.log(
        `  CI: ${
          ciStatus.passing
            ? "passing"
            : ciStatus.pending
            ? "pending"
            : "failing"
        }`
      );

      if (stack.entries.length > 1) {
        console.log(`\n  Remaining: ${stack.entries.length - 1} PRs to rebase`);
      }
      return;
    }

    // Check if PR is mergeable
    if (!status.mergeable) {
      throw new PRNotMergeableError(
        bottomEntry.prNumber,
        status.mergeStateStatus,
        "This could be due to merge conflicts, required reviews, or branch protection rules."
      );
    }

    // Check review status
    if (status.reviewDecision === "CHANGES_REQUESTED") {
      throw new ChangesRequestedError(bottomEntry.prNumber);
    }

    if (status.reviewDecision === "REVIEW_REQUIRED") {
      throw new ReviewRequiredError(bottomEntry.prNumber);
    }

    // Check CI status
    const ciStatus = await areCIChecksPassing(bottomEntry.prNumber);

    if (ciStatus.failing) {
      const failedChecks = ciStatus.checks
        .filter((c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR")
        .map((c) => c.name);

      if (force) {
        const checkList = failedChecks.map((c) => `  - ${c}`).join("\n");
        logger.warn(
          `CI checks are failing:\n${checkList}\nProceeding anyway due to --force flag.`
        );
      } else {
        throw new CIFailedError(bottomEntry.prNumber, failedChecks);
      }
    }

    if (ciStatus.pending) {
      if (force) {
        logger.warn(
          `CI checks are still running. Proceeding anyway due to --force flag.`
        );
      } else {
        throw new CIPendingError(bottomEntry.prNumber);
      }
    }

    const originalBranch = await getCurrentBranch();
    const landTarget = stack.dependsOn?.topBranch ?? target;

    // === UPDATE NEXT PR BASE BEFORE MERGE ===
    // Must happen before merge to prevent GitHub from closing the PR
    // when its base branch (the first PR's branch) is deleted
    if (stack.entries.length > 1) {
      const nextEntry = stack.entries[1]!;
      if (nextEntry.prNumber) {
        logger.info(
          `Updating PR #${nextEntry.prNumber} base to ${landTarget}...`
        );
        await updatePR({
          number: nextEntry.prNumber,
          base: landTarget,
        });
      }
    }

    // === MERGE ===
    // Use squash merge with clean commit message (metadata stripped)
    // This keeps CI valid since we don't modify the branch before merging
    logger.info(
      `Landing PR #${bottomEntry.prNumber}: ${bottomEntry.commit.subject}`
    );

    const currentMessage = await getCommitMessage(bottomEntry.commit.sha);
    const cleanedMessage = stripStackerTrailers(currentMessage);
    const lines = cleanedMessage.split("\n");
    const title = `${lines[0]} (#${bottomEntry.prNumber})`;
    const body = lines.slice(1).join("\n").trim() || " ";

    await mergePR({
      number: bottomEntry.prNumber,
      method: "squash",
      deleteBranch: true,
      title,
      body,
    });

    logger.success(`Merged PR #${bottomEntry.prNumber}`);

    // === REBASE REMAINING ===
    await fetch(remote, landTarget);

    if (stack.entries.length > 1) {
      logger.info(`Rebasing ${stack.entries.length - 1} remaining PRs...`);

      // Rebase each remaining PR onto the updated target
      // This follows the stack-pr approach: checkout remote branch, rebase, force push
      for (let i = 1; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        logger.debug(`Rebasing ${entry.branchName}...`, verbose);

        // Checkout the remote branch locally
        await fetch(remote, entry.branchName);
        await exec(
          `git checkout ${remote}/${entry.branchName} -B ${entry.branchName}`
        );

        // Rebase onto updated target
        try {
          await exec(
            `git rebase ${remote}/${landTarget} ${entry.branchName} --committer-date-is-author-date`
          );
        } catch (error) {
          throw new RebaseConflictError(
            error instanceof Error ? error : undefined
          );
        }

        // Force push the rebased branch
        await exec(
          `git push ${remote} -f ${entry.branchName}:${entry.branchName}`
        );
        logger.debug(`Pushed ${entry.branchName}`, verbose);
      }

      // Return to original branch and rebase it too
      await checkout(originalBranch);
      try {
        await rebaseOnto(`${remote}/${landTarget}`);
      } catch (error) {
        throw new RebaseConflictError(
          error instanceof Error ? error : undefined
        );
      }
    }

    // === AUTO-REBASE DEPENDENTS ===
    const dependents = await findDependentStacks(stack.name);
    for (const depBranch of dependents) {
      logger.info(`Rebasing dependent stack: ${depBranch}`);
      // This would require more complex logic to properly rebase dependent stacks
      // For now, just log a warning
      logger.warn(
        `Dependent stack ${depBranch} may need to be rebased manually`
      );
    }

    logger.success("SUCCESS!");

    // Show remaining stack
    if (stack.entries.length > 1) {
      logger.blank();
      logger.header("Remaining PRs:");
      for (let i = 1; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        console.log(`  #${entry.prNumber} - ${entry.commit.subject}`);
      }
    }

    // If --all, recursively land remaining
    if (all && stack.entries.length > 1) {
      logger.blank();
      logger.info("Landing next PR...");
      // Recursive call - rebuild stack and land again
      await landCommand(argv);
    }
  } catch (error) {
    handleError(error, verbose);
  }
}
