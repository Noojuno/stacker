/**
 * Edit command - Interactive commit editing
 */

import type { ArgumentsCamelCase } from "yargs";
import { buildStack } from "../core/stack";
import { validatePrerequisites } from "../core/validate";
import {
  isRebaseInProgress,
  continueRebase,
  abortRebase,
  getMergeBase,
} from "../core/git";
import { exec } from "../utils/exec";
import { handleError } from "../utils/error-handler";
import { logger } from "../utils/logger";
import { RebaseInProgressError } from "../utils/errors";
import { runEditTUI, generateRebaseTodo, printEditHelp } from "../tui/edit-app";

export async function editCommand(argv: ArgumentsCamelCase): Promise<void> {
  const opts = argv as unknown as {
    remote: string;
    base?: string;
    head: string;
    target: string;
    verbose: boolean;
    continue?: boolean;
    abort?: boolean;
  };

  const { remote, base, head, target, verbose } = opts;

  try {
    // Check for rebase in progress
    const rebaseInProgress = await isRebaseInProgress();

    if (opts.continue) {
      if (!rebaseInProgress) {
        logger.warn("No rebase in progress");
        return;
      }
      logger.info("Continuing rebase...");
      await continueRebase();
      logger.success("Rebase continued successfully");
      return;
    }

    if (opts.abort) {
      if (!rebaseInProgress) {
        logger.warn("No rebase in progress");
        return;
      }
      logger.info("Aborting rebase...");
      await abortRebase();
      logger.success("Rebase aborted");
      return;
    }

    // Check if there's already a rebase in progress
    if (rebaseInProgress) {
      throw new RebaseInProgressError();
    }

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
      logger.warn("No commits found in stack range");
      return;
    }

    logger.info(`Found ${stack.entries.length} commits to edit`);

    // Check if we should use TUI or simple text
    if (!process.stdout.isTTY) {
      printEditHelp();
      return;
    }

    // Run the edit TUI
    let actions;
    try {
      actions = await runEditTUI(stack);
    } catch (tuiError) {
      logger.debug(`TUI failed: ${tuiError}`, verbose);
      printEditHelp();
      return;
    }

    if (!actions) {
      logger.info("Edit cancelled");
      return;
    }

    // Check if any actions are non-pick
    const hasChanges = actions.some((a) => a.type !== "pick");
    if (!hasChanges) {
      logger.info("No changes to make");
      return;
    }

    // Generate rebase todo
    const todoContent = generateRebaseTodo(actions);
    logger.debug(`Rebase todo:\n${todoContent}`, verbose);

    // Write todo to temp file
    const todoFile = `/tmp/stacker-rebase-todo-${Date.now()}`;
    await Bun.write(todoFile, todoContent);

    // Get the base for rebase
    const rebaseBase = base || (await getMergeBase(head, `${remote}/${target}`));

    // Execute interactive rebase with our todo file
    logger.info("Starting rebase...");
    
    try {
      // Use a custom sequence editor that just copies our todo file
      await exec(`GIT_SEQUENCE_EDITOR="cp ${todoFile}" git rebase -i ${rebaseBase}`);
      logger.success("Rebase completed successfully!");
    } catch (error) {
      // Rebase might have stopped for editing
      const stillInProgress = await isRebaseInProgress();
      if (stillInProgress) {
        logger.info("Rebase paused for editing.");
        logger.info("Make your changes, then run:");
        logger.info("  stacker amend     # to amend the current commit");
        logger.info("  stacker edit --continue  # to continue the rebase");
      } else {
        throw error;
      }
    } finally {
      // Clean up temp file
      try {
        await exec(`rm -f "${todoFile}"`);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    handleError(error, verbose);
  }
}
