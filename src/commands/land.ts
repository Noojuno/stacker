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
  pushBranch,
  getCommitMessage,
  amendCommitMessage,
  getCurrentBranch,
} from "../core/git";
import { stripStackerTrailers } from "../utils/trailers";
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

  const { remote, base, head, target, verbose = false, all, dryRun, force } = opts;

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
      console.log(`  PR #${bottomEntry.prNumber}: ${bottomEntry.commit.subject}`);
      console.log(`  Mergeable: ${status.mergeable}`);
      console.log(`  Review: ${status.reviewDecision ?? "none"}`);
      console.log(`  State: ${status.mergeStateStatus}`);
      
      const ciStatus = await areCIChecksPassing(bottomEntry.prNumber);
      console.log(`  CI: ${ciStatus.passing ? "passing" : ciStatus.pending ? "pending" : "failing"}`);
      
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

    // === STRIP METADATA ===
    logger.info("Cleaning commit metadata...");
    const originalBranch = await getCurrentBranch();
    
    await checkout(bottomEntry.branchName);
    const currentMessage = await getCommitMessage("HEAD");
    const cleanedMessage = stripStackerTrailers(currentMessage);
    
    if (cleanedMessage !== currentMessage) {
      await amendCommitMessage(cleanedMessage);
      await pushBranch(remote, bottomEntry.branchName, true);
    }

    // === MERGE ===
    logger.info(`Landing PR #${bottomEntry.prNumber}: ${bottomEntry.commit.subject}`);
    await mergePR({
      number: bottomEntry.prNumber,
      method: "rebase",
      deleteBranch: true,
    });

    logger.success(`Merged PR #${bottomEntry.prNumber}`);

    // === REBASE REMAINING ===
    const landTarget = stack.dependsOn?.topBranch ?? target;
    await fetch(remote, landTarget);

    if (stack.entries.length > 1) {
      logger.info(`Rebasing ${stack.entries.length - 1} remaining PRs...`);

      // Checkout the original branch
      await checkout(originalBranch);

      // Rebase onto updated target
      try {
        await rebaseOnto(`${remote}/${landTarget}`);
      } catch (error) {
        throw new RebaseConflictError(error instanceof Error ? error : undefined);
      }

      // Update base branch for next PR
      const nextEntry = stack.entries[1]!;
      if (nextEntry.prNumber) {
        await updatePR({
          number: nextEntry.prNumber,
          base: landTarget,
        });
      }

      // Force push all remaining stack branches
      for (let i = 1; i < stack.entries.length; i++) {
        const entry = stack.entries[i]!;
        await pushBranch(remote, entry.branchName, true);
        logger.debug(`Pushed ${entry.branchName}`, verbose);
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
