/**
 * View - Text-based stack viewer
 */

import type { Stack } from "../types";

/** Column widths (fixed columns) */
const COL_NUM = 4;
const COL_SHA = 9;
const COL_PR = 8;
const COL_GAP = 2;
const MIN_TITLE_WIDTH = 20;

/**
 * Truncate a string if it exceeds the given width
 */
function truncate(str: string, maxWidth: number): string {
  if (str.length <= maxWidth) {
    return str;
  }
  return str.slice(0, maxWidth - 1) + "…";
}

/**
 * Get terminal width, with a sensible default
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 120;
}

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

  if (stack.entries.length === 0) {
    console.log("\x1b[2m  (no commits in stack range)\x1b[0m");
    console.log();
    return;
  }

  const termWidth = getTerminalWidth();
  
  // Fixed columns width (without URL): # + SHA + PR + 3 gaps
  const fixedColumnsWidth = COL_NUM + COL_SHA + COL_PR + COL_GAP * 3;
  
  // Calculate longest URL
  const maxUrlWidth = Math.max(
    0,
    ...stack.entries.map((e) => e.prUrl?.length || 0)
  );
  
  // Determine if we have room for URLs
  // We need: fixedColumns + minTitle + gap + urlWidth <= termWidth
  const spaceNeededWithUrl = fixedColumnsWidth + MIN_TITLE_WIDTH + COL_GAP + maxUrlWidth;
  const showUrls = maxUrlWidth > 0 && spaceNeededWithUrl <= termWidth;
  
  // Calculate max title width (for truncation) based on whether we're showing URLs
  let maxTitleWidth: number;
  if (showUrls) {
    // termWidth = fixedColumns + titleWidth + gap + urlWidth
    maxTitleWidth = termWidth - fixedColumnsWidth - COL_GAP - maxUrlWidth;
  } else {
    // termWidth = fixedColumns + titleWidth
    maxTitleWidth = termWidth - fixedColumnsWidth;
  }

  // Calculate the actual title column width (longest title after truncation)
  const titleColumnWidth = Math.max(
    5, // "Title" header
    ...stack.entries.map((e) => Math.min(e.commit.subject.length, maxTitleWidth))
  );

  // Header
  const headerParts = [
    "#".padStart(COL_NUM),
    "SHA".padEnd(COL_SHA),
    "PR".padEnd(COL_PR),
    "Title".padEnd(titleColumnWidth),
  ];
  if (showUrls) {
    headerParts.push("URL".padEnd(maxUrlWidth));
  }
  const header = headerParts.join("  ");

  console.log(`\x1b[2m${header}\x1b[0m`);
  console.log(`\x1b[2m${"─".repeat(header.length)}\x1b[0m`);

  // Rows
  for (let i = 0; i < stack.entries.length; i++) {
    const entry = stack.entries[i]!;
    const num = String(i + 1).padStart(COL_NUM);
    const sha = `\x1b[33m${entry.commit.shortSha.padEnd(COL_SHA)}\x1b[0m`;
    const pr = entry.prNumber
      ? `\x1b[36m${`#${entry.prNumber}`.padEnd(COL_PR)}\x1b[0m`
      : `\x1b[2m${"(new)".padEnd(COL_PR)}\x1b[0m`;
    const title = truncate(entry.commit.subject, maxTitleWidth).padEnd(titleColumnWidth);

    const rowParts = [num, sha, pr, title];
    if (showUrls && entry.prUrl) {
      rowParts.push(`\x1b[2m${entry.prUrl}\x1b[0m`);
    }

    console.log(rowParts.join("  "));
  }

  console.log();
}
