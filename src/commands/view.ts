/**
 * View command - Display current stack state
 */

import type { ArgumentsCamelCase } from "yargs";
import { buildStack } from "../core/stack";
import { validatePrerequisites } from "../core/validate";
import { printStackText } from "../tui/view-app";
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

    printStackText(stack);
  } catch (error) {
    handleError(error, verbose);
  }
}
