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
import { multiselect, isCancel } from "@clack/prompts";
import { generateRebaseTodo, printEditHelp } from "../tui/edit-app";
import type { RebaseAction } from "../types";

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

    // Check if we should use prompts or simple text
    if (!process.stdout.isTTY) {
      printEditHelp();
      return;
    }

    // Prompt user to select commits to edit
    const selected = await multiselect({
      message: "Select commits to edit",
      options: stack.entries.map((entry) => ({
        value: entry.commit.sha,
        label: `${entry.commit.shortSha} ${entry.commit.subject}`,
      })),
      required: false,
    });

    if (isCancel(selected)) {
      logger.info("Edit cancelled");
      return;
    }

    const selectedShas = new Set(selected as string[]);

    // Build rebase actions: selected commits get 'edit', others get 'pick'
    const actions: RebaseAction[] = stack.entries.map((entry) => ({
      type: selectedShas.has(entry.commit.sha) ? "edit" : "pick",
      sha: entry.commit.sha,
      subject: entry.commit.subject,
    }));

    // Check if any actions are non-pick
    const hasChanges = actions.some((a) => a.type !== "pick");
    if (!hasChanges) {
      logger.info("No commits selected to edit");
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
