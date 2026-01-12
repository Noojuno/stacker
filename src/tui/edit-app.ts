/**
 * Edit utilities - Helpers for commit editing
 */

import type { RebaseAction } from "../types";

/**
 * Generate a git rebase-todo file from actions
 */
export function generateRebaseTodo(actions: RebaseAction[]): string {
  const lines: string[] = [];

  for (const action of actions) {
    // Git rebase uses short action names
    const actionName = action.type === "drop" ? "drop" : action.type;
    lines.push(`${actionName} ${action.sha.slice(0, 7)} ${action.subject}`);
  }

  return lines.join("\n");
}

/**
 * Simple text-based edit prompt (fallback for non-TTY)
 */
export function printEditHelp(): void {
  console.log();
  console.log("\x1b[1mEdit Mode\x1b[0m");
  console.log();
  console.log("To edit commits in your stack:");
  console.log("  1. Use 'stacker edit' to launch the interactive editor");
  console.log("  2. Select commits to edit");
  console.log("  3. Press Enter to execute the rebase");
  console.log();
  console.log("If a rebase is in progress:");
  console.log("  - Make your changes");
  console.log("  - Run 'stacker amend' to amend the current commit");
  console.log("  - Run 'stacker edit --continue' to continue");
  console.log("  - Run 'stacker edit --abort' to abort");
  console.log();
}
