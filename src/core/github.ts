/**
 * GitHub operations via gh CLI
 * 
 * All GitHub API interactions go through the gh CLI for simplicity
 * and to leverage existing authentication.
 */

import { execStdout, exec, commandExists } from "../utils/exec";
import {
  GhCliNotInstalledError,
  GhNotAuthenticatedError,
  GitHubAPIError,
  PRCreationError,
  PRMergeError,
  PRNotFoundError,
  PRUpdateError,
} from "../utils/errors";
import type { PRStatus } from "../types";

/**
 * Ensure gh CLI is available and authenticated
 */
export async function ensureGhCli(): Promise<void> {
  const hasGh = await commandExists("gh");
  if (!hasGh) {
    throw new GhCliNotInstalledError();
  }

  // Check if authenticated
  const result = await exec("gh auth status", { ignoreExitCode: true });
  if (result.exitCode !== 0) {
    throw new GhNotAuthenticatedError(new Error(result.stderr));
  }
}

/**
 * Get the authenticated GitHub username
 */
export async function getGitHubUsername(): Promise<string> {
  try {
    const output = await execStdout("gh api user --jq .login");
    return output.trim();
  } catch (error) {
    throw new GitHubAPIError(
      "fetching username",
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get the current repository in owner/repo format
 */
export async function getCurrentRepo(): Promise<string> {
  try {
    const output = await execStdout(
      "gh repo view --json nameWithOwner --jq .nameWithOwner"
    );
    return output.trim();
  } catch (error) {
    throw new GitHubAPIError(
      "fetching repository info",
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Create a new pull request
 */
export async function createPR(options: {
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
  reviewers?: string[];
}): Promise<number> {
  const { head, base, title, body, draft = false, reviewers = [] } = options;

  // Build command
  let cmd = `gh pr create --head "${head}" --base "${base}" --title "${escapeForShell(title)}"`;
  
  if (draft) {
    cmd += " --draft";
  }
  
  if (reviewers.length > 0) {
    cmd += ` --reviewer "${reviewers.join(",")}"`;
  }

  // Write body to temp file to handle complex content
  const bodyFile = `/tmp/stacker-pr-body-${Date.now()}`;
  await Bun.write(bodyFile, body);
  cmd += ` --body-file "${bodyFile}"`;

  try {
    const output = await execStdout(cmd);
    // Extract PR number from URL
    const match = output.match(/\/pull\/(\d+)/);
    if (match) {
      return parseInt(match[1]!, 10);
    }
    throw new PRCreationError(head, "could not parse PR number from response");
  } catch (error) {
    if (error instanceof PRCreationError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    let reason = "unknown error";
    if (msg.includes("already exists")) {
      reason = "a PR already exists for this branch";
    } else if (msg.includes("permission") || msg.includes("403")) {
      reason = "permission denied";
    } else if (msg.includes("not found") || msg.includes("404")) {
      reason = "repository or branch not found";
    }
    throw new PRCreationError(head, reason, error instanceof Error ? error : undefined);
  } finally {
    await exec(`rm -f "${bodyFile}"`, { ignoreExitCode: true });
  }
}

/**
 * Update an existing pull request
 */
export async function updatePR(options: {
  number: number;
  title?: string;
  body?: string;
  base?: string;
}): Promise<void> {
  const { number, title, body, base } = options;

  let cmd = `gh pr edit ${number}`;

  if (title) {
    cmd += ` --title "${escapeForShell(title)}"`;
  }

  if (base) {
    cmd += ` --base "${base}"`;
  }

  try {
    if (body !== undefined) {
      // Write body to temp file
      const bodyFile = `/tmp/stacker-pr-body-${Date.now()}`;
      await Bun.write(bodyFile, body);
      cmd += ` --body-file "${bodyFile}"`;

      try {
        await exec(cmd);
      } finally {
        await exec(`rm -f "${bodyFile}"`, { ignoreExitCode: true });
      }
    } else {
      await exec(cmd);
    }
  } catch (error) {
    throw new PRUpdateError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Find a PR by its head branch
 */
export async function findPRByBranch(
  headBranch: string
): Promise<number | null> {
  try {
    const output = await execStdout(
      `gh pr list --head "${headBranch}" --json number --jq ".[0].number"`
    );
    const num = parseInt(output.trim(), 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

/**
 * Get PR details
 */
export async function getPR(number: number): Promise<{
  number: number;
  title: string;
  body: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
}> {
  try {
    const output = await execStdout(
      `gh pr view ${number} --json number,title,body,state,headRefName,baseRefName,url`
    );
    return JSON.parse(output);
  } catch (error) {
    throw new PRNotFoundError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Get PR status for landing checks
 */
export async function getPRStatus(number: number): Promise<PRStatus> {
  try {
    const output = await execStdout(
      `gh pr view ${number} --json number,mergeable,mergeStateStatus,reviewDecision,state,statusCheckRollup`
    );
    const data = JSON.parse(output);
    
    return {
      number: data.number,
      mergeable: data.mergeable === "MERGEABLE",
      mergeStateStatus: data.mergeStateStatus || "UNKNOWN",
      reviewDecision: data.reviewDecision || null,
      state: data.state,
      statusCheckRollup: (data.statusCheckRollup || []).map((check: {
        name?: string;
        context?: string;
        status?: string;
        state?: string;
        conclusion?: string;
      }) => ({
        name: check.name || check.context || "Unknown",
        status: check.status || check.state || "UNKNOWN",
        conclusion: check.conclusion || null,
      })),
    };
  } catch (error) {
    throw new PRNotFoundError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Merge a PR
 */
export async function mergePR(options: {
  number: number;
  method?: "squash" | "merge" | "rebase";
  deleteBranch?: boolean;
  title?: string;
  body?: string;
}): Promise<void> {
  const { number, method = "rebase", deleteBranch = true, title, body } = options;

  let cmd = `gh pr merge ${number} --${method}`;
  
  if (deleteBranch) {
    cmd += " --delete-branch";
  }

  // For squash merges, we can pass a custom title and body
  // This allows us to strip metadata from the final commit without
  // modifying the branch (which would invalidate CI checks)
  if (title) {
    cmd += ` -t "${escapeForShell(title)}"`;
  }

  try {
    if (body !== undefined) {
      // Write body to temp file to handle complex content
      const bodyFile = `/tmp/stacker-merge-body-${Date.now()}`;
      await Bun.write(bodyFile, body);
      cmd += ` -F "${bodyFile}"`;
      
      try {
        await exec(cmd);
      } finally {
        await exec(`rm -f "${bodyFile}"`, { ignoreExitCode: true });
      }
    } else {
      await exec(cmd);
    }
  } catch (error) {
    throw new PRMergeError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Close a PR without merging
 */
export async function closePR(number: number): Promise<void> {
  try {
    await exec(`gh pr close ${number}`);
  } catch (error) {
    throw new PRNotFoundError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Open a PR in the browser
 */
export async function openPRInBrowser(number: number): Promise<void> {
  await exec(`gh pr view ${number} --web`);
}

/**
 * Add reviewers to a PR
 */
export async function addReviewers(
  number: number,
  reviewers: string[]
): Promise<void> {
  if (reviewers.length === 0) return;
  try {
    await exec(`gh pr edit ${number} --add-reviewer "${reviewers.join(",")}"`);
  } catch (error) {
    throw new PRUpdateError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Get the web URL for a PR
 */
export async function getPRUrl(number: number): Promise<string> {
  try {
    const output = await execStdout(`gh pr view ${number} --json url --jq .url`);
    return output.trim();
  } catch (error) {
    throw new PRNotFoundError(number, error instanceof Error ? error : undefined);
  }
}

/**
 * Check if CI checks are passing
 */
export async function areCIChecksPassing(number: number): Promise<{
  passing: boolean;
  pending: boolean;
  failing: boolean;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
}> {
  const status = await getPRStatus(number);
  
  let passing = true;
  let pending = false;
  let failing = false;
  
  for (const check of status.statusCheckRollup) {
    if (check.conclusion === "FAILURE" || check.conclusion === "ERROR") {
      failing = true;
      passing = false;
    } else if (
      check.status === "IN_PROGRESS" ||
      check.status === "PENDING" ||
      check.status === "QUEUED"
    ) {
      pending = true;
      passing = false;
    }
  }
  
  return {
    passing,
    pending,
    failing,
    checks: status.statusCheckRollup,
  };
}

/**
 * Escape a string for use in shell commands
 */
function escapeForShell(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}
