/**
 * View command - Display current stack state
 */

import type { ArgumentsCamelCase } from "yargs";
import { buildStack } from "../core/stack";
import { validatePrerequisites } from "../core/validate";
import { runViewTUI, printStackText } from "../tui/view-app";
import { handleError } from "../utils/error-handler";
import { logger } from "../utils/logger";

export async function viewCommand(argv: ArgumentsCamelCase): Promise<void> {
  const { remote, base, head, target, verbose } = argv as unknown as {
    remote: string;
    base?: string;
    head: string;
    target: string;
    verbose: boolean;
  };

  try {
    // Validate prerequisites
    await validatePrerequisites({
      requireGitRepo: true,
      requireCommits: true,
      requireRemote: remote,
      requireGh: true,
    });

    // Build the stack
    const stack = await buildStack({
      base,
      head,
      target,
      remote,
    });

    if (verbose) {
      logger.debug(`Stack name: ${stack.name}`, verbose);
      logger.debug(`Target: ${stack.target}`, verbose);
      logger.debug(`Entries: ${stack.entries.length}`, verbose);
      if (stack.dependsOn) {
        logger.debug(`Depends on: ${stack.dependsOn.stackName}`, verbose);
      }
    }

    // Check if we should use TUI or simple text
    // Use simple text mode if stdout is not a TTY
    if (!process.stdout.isTTY) {
      printStackText(stack);
      return;
    }

    // Try to run TUI, fall back to text on error
    try {
      await runViewTUI({
        stack,
        onEdit: async () => {
          console.log("Edit mode not available from view");
        },
        onSubmit: async () => {
          console.log("Submit not available from view yet");
        },
        onLand: async () => {
          console.log("Land not available from view yet");
        },
      });
    } catch (tuiError) {
      if (verbose) {
        logger.debug(`TUI failed, using text mode: ${tuiError}`, verbose);
      }
      printStackText(stack);
    }
  } catch (error) {
    handleError(error, verbose);
  }
}
