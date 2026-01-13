/**
 * Stack management logic
 * 
 * Handles building stacks from commits, detecting dependencies,
 * and generating PR body cross-links.
 */

import type { Commit, Stack, StackEntry, StackDependency } from "../types";
import { TRAILER_KEYS, getStackerTrailers, stripStackerTrailers } from "../utils/trailers";
import {
  getCurrentBranch,
  getMergeBase,
  getCommitsInRange,
  parseCommit,
} from "./git";
import { findPRByBranch, getPR, getCurrentRepo } from "./github";
import { loadConfig } from "./config";

/**
 * Extract the stack name from a branch name
 * e.g., "stack/update-docs/3" -> "update-docs"
 */
export function extractStackName(branchName: string): string {
  const match = branchName.match(/^stack\/(.+?)\/\d+$/);
  return match ? match[1]! : branchName;
}

/**
 * Check if a branch name is a stack branch
 */
export function isStackBranch(branchName: string): boolean {
  return /^stack\/.+\/\d+$/.test(branchName);
}

/**
 * Generate a stack branch name
 */
export function generateStackBranchName(
  baseBranch: string,
  index: number
): string {
  return `stack/${baseBranch}/${index}`;
}

/**
 * Detect if the current stack depends on another stack
 * 
 * This is detected by:
 * 1. Checking if the merge-base commit has Stacker trailers from a different stack
 * 2. Checking if current branch was created from another stack's branch
 */
export async function detectDependency(
  currentBranch: string,
  target: string
): Promise<StackDependency | null> {
  try {
    // Get the merge base with target
    const mergeBase = await getMergeBase(currentBranch, target);
    
    // Parse the merge-base commit to see if it has stack trailers
    const baseCommit = await parseCommit(mergeBase);
    const trailers = getStackerTrailers(baseCommit.body);
    const baseStackBranch = trailers.get(TRAILER_KEYS.BRANCH);
    
    if (baseStackBranch) {
      // Extract stack name from the branch
      const baseStackName = extractStackName(baseStackBranch);
      const currentStackName = extractStackName(currentBranch);
      
      // If different stack names, this is a dependency
      if (baseStackName !== currentStackName) {
        const prNumStr = trailers.get(TRAILER_KEYS.PR);
        const prNumber = prNumStr ? parseInt(prNumStr, 10) : undefined;
        
        return {
          stackName: baseStackName,
          topBranch: baseStackBranch,
          prNumber,
          autoDetected: true,
        };
      }
    }
  } catch {
    // If we can't detect, that's fine - just return null
  }
  
  return null;
}

/**
 * Build a stack from commits in a range
 */
export async function buildStack(options: {
  base?: string;
  head?: string;
  target?: string;
  remote?: string;
}): Promise<Stack> {
  const config = await loadConfig();
  const {
    head = "HEAD",
    target = config.repo.target,
    remote = config.repo.remote,
  } = options;
  
  // Get current branch name for stack naming
  const currentBranch = await getCurrentBranch();
  const stackName = extractStackName(currentBranch);
  
  // Determine base (merge-base with target if not specified)
  let base = options.base;
  if (!base) {
    base = await getMergeBase(head, `${remote}/${target}`);
  }
  
  // Get commits in range
  const commits = await getCommitsInRange(base, head);
  
  // Detect dependency on another stack
  const dependsOn = await detectDependency(currentBranch, `${remote}/${target}`);
  
  // Get repo for constructing PR URLs
  const repo = await getCurrentRepo();
  
  // Build stack entries
  const entries: StackEntry[] = [];
  
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!;
    const trailers = getStackerTrailers(commit.body);
    
    // Get branch name from trailer or generate new one
    let branchName = trailers.get(TRAILER_KEYS.BRANCH);
    if (!branchName) {
      branchName = generateStackBranchName(stackName, i + 1);
    }
    
    // Get PR number from trailer or look it up
    let prNumber: number | undefined;
    const prNumStr = trailers.get(TRAILER_KEYS.PR);
    if (prNumStr) {
      prNumber = parseInt(prNumStr, 10);
    } else {
      // Try to find existing PR by branch
      const foundPr = await findPRByBranch(branchName);
      if (foundPr) {
        prNumber = foundPr;
      }
    }
    
    // Determine target branch for this PR
    let targetBranch: string;
    if (i === 0) {
      // First commit targets either the dependent stack's top or main
      targetBranch = dependsOn?.topBranch ?? target;
    } else {
      // Subsequent commits target the previous stack branch
      targetBranch = entries[i - 1]!.branchName;
    }
    
    // Construct PR URL if we have a PR number
    const prUrl = prNumber ? `https://github.com/${repo}/pull/${prNumber}` : undefined;
    
    entries.push({
      commit,
      prNumber,
      prUrl,
      branchName,
      targetBranch,
    });
  }
  
  return {
    name: stackName,
    entries,
    target,
    dependsOn: dependsOn ?? undefined,
  };
}

/**
 * Generate the PR body with stack cross-links
 */
export function generatePRBody(
  stack: Stack,
  currentIndex: number,
  originalBody?: string
): string {
  const lines: string[] = [];
  
  // Stack header
  lines.push("<!-- stacker:start -->");
  lines.push("## Stack");
  lines.push("");
  
  // Show dependency if exists
  if (stack.dependsOn) {
    const depPr = stack.dependsOn.prNumber
      ? `#${stack.dependsOn.prNumber}`
      : stack.dependsOn.topBranch;
    lines.push(
      `> This stack depends on **${stack.dependsOn.stackName}** (${depPr})`
    );
    lines.push("");
  }
  
  // Stack table
  lines.push("| # | PR | Title |");
  lines.push("|---|-----|-------|");
  
  for (let i = 0; i < stack.entries.length; i++) {
    const entry = stack.entries[i]!;
    const num = i + 1;
    const prRef = entry.prNumber ? `#${entry.prNumber}` : "(pending)";
    const title = entry.commit.subject;
    
    if (i === currentIndex) {
      // Highlight current PR
      lines.push(`| ${num} | **${prRef}** | **${title} (this PR)** |`);
    } else {
      lines.push(`| ${num} | ${prRef} | ${title} |`);
    }
  }
  
  lines.push("");
  
  // Add Prev/Next navigation links
  const prevEntry = currentIndex > 0 ? stack.entries[currentIndex - 1] : null;
  const nextEntry = currentIndex < stack.entries.length - 1 ? stack.entries[currentIndex + 1] : null;
  
  const navParts: string[] = [];
  if (prevEntry) {
    const prevRef = prevEntry.prNumber ? `#${prevEntry.prNumber}` : prevEntry.branchName;
    navParts.push(`⬅️ Prev: ${prevRef}`);
  }
  if (nextEntry) {
    const nextRef = nextEntry.prNumber ? `#${nextEntry.prNumber}` : nextEntry.branchName;
    navParts.push(`Next: ${nextRef} ➡️`);
  }
  
  if (navParts.length > 0) {
    lines.push(navParts.join(" | "));
    lines.push("");
  }
  
  lines.push("---");
  lines.push("<!-- stacker:end -->");
  
  // Add commit message body as PR description
  const currentEntry = stack.entries[currentIndex];
  if (currentEntry) {
    const commitBody = stripStackerTrailers(currentEntry.commit.body).trim();
    if (commitBody) {
      lines.push("");
      lines.push(commitBody);
    }
  }
  
  // Add original body if provided (excluding any commit body that might have been there)
  if (originalBody) {
    // Remove existing stacker section
    const cleanedBody = removeStackerSection(originalBody);
    if (cleanedBody.trim()) {
      lines.push("");
      lines.push(cleanedBody);
    }
  }
  
  return lines.join("\n");
}

/**
 * Remove the stacker section from a PR body
 */
export function removeStackerSection(body: string): string {
  const startMarker = "<!-- stacker:start -->";
  const endMarker = "<!-- stacker:end -->";
  
  const startIdx = body.indexOf(startMarker);
  const endIdx = body.indexOf(endMarker);
  
  if (startIdx === -1 || endIdx === -1) {
    return body;
  }
  
  const before = body.slice(0, startIdx);
  const after = body.slice(endIdx + endMarker.length);
  
  return (before + after).trim();
}

/**
 * Find all stacks that depend on a given stack
 */
export async function findDependentStacks(
  stackName: string
): Promise<string[]> {
  // This would require scanning all local branches and their commits
  // For now, return empty array - this will be enhanced later
  // when we implement proper stack tracking
  return [];
}

/**
 * Get the top branch of a stack
 */
export function getStackTopBranch(stack: Stack): string {
  if (stack.entries.length === 0) {
    return stack.target;
  }
  return stack.entries[stack.entries.length - 1]!.branchName;
}

/**
 * Validate that a stack is in a good state
 */
export async function validateStack(stack: Stack): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (stack.entries.length === 0) {
    warnings.push("No commits in stack range");
  }
  
  // Check for missing PRs
  for (const entry of stack.entries) {
    if (!entry.prNumber) {
      warnings.push(`Commit ${entry.commit.shortSha} has no PR yet`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
