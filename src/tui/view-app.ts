/**
 * View - Text-based stack viewer
 */

import type { Stack } from "../types";

/**
 * Print stack in text format
 */
export function printStackText(stack: Stack): void {
  console.log();
  console.log(`\x1b[1mStack: ${stack.name}\x1b[0m`);
  console.log(`Target: ${stack.target}`);

  if (stack.dependsOn) {
    console.log(
      `Depends on: ${stack.dependsOn.stackName} (${stack.dependsOn.topBranch})`
    );
  }

  console.log();
  console.log("\x1b[2m#   SHA       PR      Branch                    Title\x1b[0m");
  console.log("\x1b[2m" + "─".repeat(70) + "\x1b[0m");

  if (stack.entries.length === 0) {
    console.log("\x1b[2m  (no commits in stack range)\x1b[0m");
  }

  for (let i = 0; i < stack.entries.length; i++) {
    const entry = stack.entries[i]!;
    const num = String(i + 1).padStart(2, " ");
    const sha = `\x1b[33m${entry.commit.shortSha}\x1b[0m`;
    const pr = entry.prNumber
      ? `\x1b[36m#${entry.prNumber}\x1b[0m`.padEnd(15)
      : "\x1b[2m(new)\x1b[0m  ";
    const subject = entry.commit.subject.slice(0, 35);

    console.log(`${num}  ${sha}  ${pr}  ${subject}`);
  }

  console.log();
}
