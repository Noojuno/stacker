/**
 * Amend command - Stage all changes and amend current commit
 */

import type { ArgumentsCamelCase } from "yargs";
import { stageAll, amendNoEdit, amendWithMessage } from "../core/git";
import { validatePrerequisites } from "../core/validate";
import { exec } from "../utils/exec";
import { handleError } from "../utils/error-handler";
import { logger } from "../utils/logger";

export async function amendCommand(argv: ArgumentsCamelCase): Promise<void> {
  const opts = argv as unknown as {
    message?: string;
    edit?: boolean;
    verbose?: boolean;
  };

  const { message, edit, verbose = false } = opts;

  try {
    // Validate prerequisites
    await validatePrerequisites({
      requireGitRepo: true,
      requireCommits: true,
    });

    // Stage all changes
    logger.info("Staging all changes...");
    await stageAll();

    if (message) {
      // Amend with new message
      logger.info("Amending commit with new message...");
      await amendWithMessage(message);
    } else if (edit) {
      // Open editor for message
      logger.info("Opening editor for commit message...");
      await exec("git commit --amend");
    } else {
      // Amend without editing message
      logger.info("Amending commit...");
      await amendNoEdit();
    }

    logger.success("Commit amended successfully!");
    logger.info("Run 'stacker submit' to update the PR");
  } catch (error) {
    handleError(error, verbose);
  }
}
