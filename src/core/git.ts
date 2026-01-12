/**
 * Git operations for stacker
 * 
 * Handles all git commands: commit parsing, branch operations, rebase, etc.
 */

import { execStdout, exec } from "../utils/exec";
import { parseTrailers, getStackerTrailers, TRAILER_KEYS } from "../utils/trailers";
import {
  BranchNotFoundError,
  CheckoutError,
  CommitNotFoundError,
  FetchError,
  GitCommandError,
  MergeBaseError,
  PushError,
  RebaseConflictError,
} from "../utils/errors";
import type { Commit } from "../types";

/**
 * Get the current branch name
 */
export async function getCurrentBranch(): Promise<string> {
  try {
    return await execStdout("git rev-parse --abbrev-ref HEAD");
  } catch (error) {
    throw new GitCommandError(
      "could not determine current branch",
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get the merge base between two refs
 */
export async function getMergeBase(ref1: string, ref2: string): Promise<string> {
  try {
    return await execStdout(`git merge-base ${ref1} ${ref2}`);
  } catch (error) {
    throw new MergeBaseError(ref1, ref2, error instanceof Error ? error : undefined);
  }
}

/**
 * Parse a single commit into a Commit object
 */
export async function parseCommit(sha: string): Promise<Commit> {
  try {
    // Get commit info using a format that's easy to parse
    const format = "%H%n%h%n%s%n%B";
    const output = await execStdout(`git log -1 --format="${format}" ${sha}`);
    const lines = output.split("\n");
    
    const fullSha = lines[0]!;
    const shortSha = lines[1]!;
    const subject = lines[2]!;
    // Body is everything after subject (line 3 onwards), but skip the duplicate subject line
    const body = lines.slice(3).join("\n").trim();
    
    const trailers = getStackerTrailers(body);
    
    return {
      sha: fullSha,
      shortSha,
      subject,
      body,
      trailers,
    };
  } catch (error) {
    throw new CommitNotFoundError(sha, error instanceof Error ? error : undefined);
  }
}

/**
 * Get commits in a range (base..head)
 * Returns commits in order from oldest to newest (bottom of stack to top)
 */
export async function getCommitsInRange(
  base: string,
  head: string
): Promise<Commit[]> {
  // Get commit SHAs in reverse chronological order, then reverse
  const output = await execStdout(
    `git log --reverse --format="%H" ${base}..${head}`
  );
  
  if (!output.trim()) {
    return [];
  }
  
  const shas = output.trim().split("\n");
  const commits: Commit[] = [];
  
  for (const sha of shas) {
    const commit = await parseCommit(sha);
    commits.push(commit);
  }
  
  return commits;
}

/**
 * Check if a branch exists locally
 */
export async function branchExists(branchName: string): Promise<boolean> {
  try {
    await exec(`git rev-parse --verify refs/heads/${branchName}`, {
      ignoreExitCode: false,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a branch exists on remote
 */
export async function remoteBranchExists(
  remote: string,
  branchName: string
): Promise<boolean> {
  try {
    await exec(`git ls-remote --exit-code --heads ${remote} ${branchName}`, {
      ignoreExitCode: false,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a branch pointing to a specific commit
 */
export async function createBranch(
  branchName: string,
  sha: string
): Promise<void> {
  // Delete if exists, then create
  const exists = await branchExists(branchName);
  if (exists) {
    await exec(`git branch -D ${branchName}`);
  }
  await exec(`git branch ${branchName} ${sha}`);
}

/**
 * Push a branch to remote (force push with lease)
 */
export async function pushBranch(
  remote: string,
  branchName: string,
  force = true
): Promise<void> {
  try {
    const forceFlag = force ? "--force-with-lease" : "";
    await exec(`git push ${forceFlag} ${remote} ${branchName}`);
  } catch (error) {
    throw new PushError(branchName, error instanceof Error ? error : undefined);
  }
}

/**
 * Delete a local branch
 */
export async function deleteLocalBranch(branchName: string): Promise<void> {
  const exists = await branchExists(branchName);
  if (exists) {
    await exec(`git branch -D ${branchName}`);
  }
}

/**
 * Delete a remote branch
 */
export async function deleteRemoteBranch(
  remote: string,
  branchName: string
): Promise<void> {
  try {
    await exec(`git push ${remote} --delete ${branchName}`);
  } catch {
    // Ignore errors if branch doesn't exist
  }
}

/**
 * Checkout a branch or commit
 */
export async function checkout(ref: string): Promise<void> {
  try {
    await exec(`git checkout ${ref}`);
  } catch (error) {
    throw new CheckoutError(ref, error instanceof Error ? error : undefined);
  }
}

/**
 * Amend the current commit with a new message
 */
export async function amendCommitMessage(newMessage: string): Promise<void> {
  // Write message to temp file to handle multi-line messages
  const tempFile = `/tmp/stacker-commit-msg-${Date.now()}`;
  await Bun.write(tempFile, newMessage);
  
  try {
    await exec(`git commit --amend -F "${tempFile}"`);
  } finally {
    // Clean up temp file
    try {
      await exec(`rm -f "${tempFile}"`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get the full commit message for a commit
 */
export async function getCommitMessage(sha: string): Promise<string> {
  return execStdout(`git log -1 --format="%B" ${sha}`);
}

/**
 * Check if there's a rebase in progress
 */
export async function isRebaseInProgress(): Promise<boolean> {
  const gitDir = await execStdout("git rev-parse --git-dir");
  const rebaseMerge = `${gitDir}/rebase-merge`;
  const rebaseApply = `${gitDir}/rebase-apply`;
  
  const checkMerge = await exec(`test -d "${rebaseMerge}"`, {
    ignoreExitCode: true,
  });
  const checkApply = await exec(`test -d "${rebaseApply}"`, {
    ignoreExitCode: true,
  });
  
  return checkMerge.exitCode === 0 || checkApply.exitCode === 0;
}

/**
 * Continue a rebase in progress
 */
export async function continueRebase(): Promise<void> {
  await exec("git rebase --continue");
}

/**
 * Abort a rebase in progress
 */
export async function abortRebase(): Promise<void> {
  await exec("git rebase --abort");
}

/**
 * Stage all changes
 */
export async function stageAll(): Promise<void> {
  await exec("git add -A");
}

/**
 * Amend the current commit (no message edit)
 */
export async function amendNoEdit(): Promise<void> {
  await exec("git commit --amend --no-edit");
}

/**
 * Amend with a new message
 */
export async function amendWithMessage(message: string): Promise<void> {
  // Escape message for shell
  const escaped = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  await exec(`git commit --amend -m "${escaped}"`);
}

/**
 * Fetch from remote
 */
export async function fetch(remote: string, ref?: string): Promise<void> {
  try {
    if (ref) {
      await exec(`git fetch ${remote} ${ref}`);
    } else {
      await exec(`git fetch ${remote}`);
    }
  } catch (error) {
    throw new FetchError(remote, error instanceof Error ? error : undefined);
  }
}

/**
 * Rebase onto a target
 */
export async function rebaseOnto(target: string): Promise<void> {
  try {
    await exec(`git rebase ${target}`);
  } catch (error) {
    throw new RebaseConflictError(error instanceof Error ? error : undefined);
  }
}

/**
 * Get the SHA of a ref
 */
export async function getSha(ref: string): Promise<string> {
  try {
    return await execStdout(`git rev-parse ${ref}`);
  } catch (error) {
    throw new BranchNotFoundError(ref, error instanceof Error ? error : undefined);
  }
}

/**
 * Check if working tree is clean
 */
export async function isWorkingTreeClean(): Promise<boolean> {
  const result = await exec("git status --porcelain", { ignoreExitCode: true });
  return result.stdout.trim() === "";
}

/**
 * Stash changes
 */
export async function stash(): Promise<void> {
  await exec("git stash");
}

/**
 * Pop stashed changes
 */
export async function stashPop(): Promise<void> {
  await exec("git stash pop");
}

/**
 * Interactive rebase with a custom todo file
 */
export async function interactiveRebase(
  base: string,
  todoContent: string
): Promise<void> {
  // Write the todo file
  const todoFile = `/tmp/stacker-rebase-todo-${Date.now()}`;
  await Bun.write(todoFile, todoContent);
  
  // Use GIT_SEQUENCE_EDITOR to inject our todo file
  await exec(`git rebase -i ${base}`, {
    env: {
      GIT_SEQUENCE_EDITOR: `cat "${todoFile}" >`,
    },
  });
}

/**
 * Get upstream tracking branch
 */
export async function getUpstreamBranch(
  branch: string
): Promise<string | null> {
  try {
    const result = await execStdout(
      `git rev-parse --abbrev-ref ${branch}@{upstream}`
    );
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Check if a ref is an ancestor of another
 */
export async function isAncestor(
  ancestor: string,
  descendant: string
): Promise<boolean> {
  const result = await exec(
    `git merge-base --is-ancestor ${ancestor} ${descendant}`,
    { ignoreExitCode: true }
  );
  return result.exitCode === 0;
}
