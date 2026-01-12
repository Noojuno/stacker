/**
 * Central error handler for user-friendly error output
 */

import { StackerError } from "./errors";
import { logger } from "./logger";

/**
 * Format and display an error, then exit
 * 
 * @param error - The error to handle
 * @param verbose - Whether to show verbose details
 */
export function handleError(error: unknown, verbose: boolean = false): never {
  if (error instanceof StackerError) {
    // Display user-friendly message
    logger.error(error.userMessage);

    // Display suggestion if available (no header, just indented)
    if (error.suggestion) {
      console.log(`  ${error.suggestion}`);
    }

    // Display verbose details if requested
    if (verbose && error.originalError) {
      console.log();
      const originalMessage = error.originalError.message;
      // Indent each line of the original error
      const indentedMessage = originalMessage
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      console.log(indentedMessage);
    }
  } else if (error instanceof Error) {
    // Unknown Error type - show the message
    logger.error(error.message);

    if (verbose && error.stack) {
      console.log();
      console.log(error.stack);
    }
  } else {
    // Unknown error type
    logger.error(String(error));
  }

  process.exit(1);
}

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
  getVerbose: (...args: T) => boolean = () => false
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      handleError(error, getVerbose(...args));
    }
  };
}
