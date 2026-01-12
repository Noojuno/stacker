/**
 * Custom error classes for user-friendly error messages
 */

/**
 * Base error class for Stacker
 * All stacker errors extend this class
 */
export class StackerError extends Error {
  /** User-friendly message explaining what went wrong */
  public userMessage: string;
  /** Suggestion for how to fix the issue */
  public suggestion?: string;
  /** Original error for verbose mode */
  public originalError?: Error;

  constructor(
    userMessage: string,
    suggestion?: string,
    originalError?: Error
  ) {
    super(userMessage);
    this.name = "StackerError";
    this.userMessage = userMessage;
    this.suggestion = suggestion;
    this.originalError = originalError;
  }
}

/**
 * Not inside a git repository
 */
export class NotInGitRepoError extends StackerError {
  constructor(originalError?: Error) {
    super(
      "Not in a git repository",
      "Run this command from within a git project, or run `git init` to create one.",
      originalError
    );
    this.name = "NotInGitRepoError";
  }
}

/**
 * Repository has no commits
 */
export class NoCommitsError extends StackerError {
  constructor(originalError?: Error) {
    super(
      "No commits in this repository",
      "Create at least one commit before using stacker.",
      originalError
    );
    this.name = "NoCommitsError";
  }
}

/**
 * No remote configured
 */
export class NoRemoteError extends StackerError {
  constructor(remoteName: string, originalError?: Error) {
    super(
      `No remote '${remoteName}' configured`,
      `Add a remote with: git remote add ${remoteName} <url>`,
      originalError
    );
    this.name = "NoRemoteError";
  }
}

/**
 * No commits in the specified range
 */
export class NoCommitsInRangeError extends StackerError {
  constructor(base: string, head: string) {
    super(
      `No commits found between '${base}' and '${head}'`,
      "Make sure you have commits ahead of the target branch."
    );
    this.name = "NoCommitsInRangeError";
  }
}

/**
 * Branch does not exist
 */
export class BranchNotFoundError extends StackerError {
  constructor(branchName: string, originalError?: Error) {
    super(
      `Branch '${branchName}' does not exist`,
      `Check the branch name or create it with: git checkout -b ${branchName}`,
      originalError
    );
    this.name = "BranchNotFoundError";
  }
}

/**
 * GitHub CLI not installed
 */
export class GhCliNotInstalledError extends StackerError {
  constructor() {
    super(
      "GitHub CLI (gh) is not installed",
      "Install it with `brew install gh` or visit https://cli.github.com"
    );
    this.name = "GhCliNotInstalledError";
  }
}

/**
 * Not authenticated with GitHub CLI
 */
export class GhNotAuthenticatedError extends StackerError {
  constructor(originalError?: Error) {
    super(
      "Not authenticated with GitHub",
      "Run `gh auth login` to authenticate.",
      originalError
    );
    this.name = "GhNotAuthenticatedError";
  }
}

/**
 * PR cannot be merged
 */
export class PRNotMergeableError extends StackerError {
  constructor(prNumber: number, reason: string, suggestion?: string) {
    super(
      `PR #${prNumber} cannot be merged: ${reason}`,
      suggestion,
      undefined
    );
    this.name = "PRNotMergeableError";
  }
}

/**
 * PR has failing CI checks
 */
export class CIFailedError extends StackerError {
  constructor(prNumber: number, failedChecks: string[]) {
    const checkList = failedChecks.map((c) => `  - ${c}`).join("\n");
    super(
      `PR #${prNumber} has failing CI checks:\n${checkList}`,
      "Fix the failing checks or use --force to land anyway."
    );
    this.name = "CIFailedError";
  }
}

/**
 * PR has pending CI checks
 */
export class CIPendingError extends StackerError {
  constructor(prNumber: number) {
    super(
      `PR #${prNumber} has pending CI checks`,
      "Wait for CI to complete or use --force to land anyway."
    );
    this.name = "CIPendingError";
  }
}

/**
 * PR requires review approval
 */
export class ReviewRequiredError extends StackerError {
  constructor(prNumber: number) {
    super(
      `PR #${prNumber} requires review approval`,
      "Get the PR approved before landing."
    );
    this.name = "ReviewRequiredError";
  }
}

/**
 * PR has changes requested
 */
export class ChangesRequestedError extends StackerError {
  constructor(prNumber: number) {
    super(
      `PR #${prNumber} has changes requested`,
      "Address the review feedback before landing."
    );
    this.name = "ChangesRequestedError";
  }
}

/**
 * Rebase already in progress
 */
export class RebaseInProgressError extends StackerError {
  constructor() {
    super(
      "A rebase is already in progress",
      "Run `stacker edit --continue` to continue or `stacker edit --abort` to abort."
    );
    this.name = "RebaseInProgressError";
  }
}

/**
 * Rebase conflict
 */
export class RebaseConflictError extends StackerError {
  constructor(originalError?: Error) {
    super(
      "Rebase failed due to conflicts",
      "Resolve the conflicts, then run `stacker edit --continue`.",
      originalError
    );
    this.name = "RebaseConflictError";
  }
}

/**
 * Network or API error
 */
export class NetworkError extends StackerError {
  constructor(originalError?: Error) {
    super(
      "Failed to connect to GitHub",
      "Check your network connection and try again.",
      originalError
    );
    this.name = "NetworkError";
  }
}

/**
 * Working tree has uncommitted changes
 */
export class DirtyWorkingTreeError extends StackerError {
  constructor() {
    super(
      "You have uncommitted changes",
      "Commit or stash your changes before running this command."
    );
    this.name = "DirtyWorkingTreeError";
  }
}

/**
 * PR not found
 */
export class PRNotFoundError extends StackerError {
  constructor(prNumber: number, originalError?: Error) {
    super(
      `PR #${prNumber} not found`,
      "Check the PR number and make sure it exists.",
      originalError
    );
    this.name = "PRNotFoundError";
  }
}

/**
 * No PR created for commit
 */
export class NoPRForCommitError extends StackerError {
  constructor(sha: string) {
    super(
      `Commit ${sha.slice(0, 8)} has no associated PR`,
      "Run `stacker submit` first to create PRs for your stack."
    );
    this.name = "NoPRForCommitError";
  }
}

/**
 * Git command failed with a generic error
 */
export class GitCommandError extends StackerError {
  constructor(message: string, originalError?: Error) {
    super(
      `Git command failed: ${message}`,
      undefined,
      originalError
    );
    this.name = "GitCommandError";
  }
}

/**
 * Checkout failed
 */
export class CheckoutError extends StackerError {
  constructor(ref: string, originalError?: Error) {
    super(
      `Failed to checkout '${ref}'`,
      "Make sure the branch or commit exists and you have no conflicting changes.",
      originalError
    );
    this.name = "CheckoutError";
  }
}

/**
 * Push failed
 */
export class PushError extends StackerError {
  constructor(branch: string, originalError?: Error) {
    const msg = originalError?.message || "";
    let suggestion = "Check your network connection and repository permissions.";
    
    if (msg.includes("rejected")) {
      suggestion = "The remote has changes. Pull first or use force push.";
    } else if (msg.includes("permission") || msg.includes("denied")) {
      suggestion = "Check your repository permissions.";
    }
    
    super(
      `Failed to push branch '${branch}'`,
      suggestion,
      originalError
    );
    this.name = "PushError";
  }
}

/**
 * Fetch failed
 */
export class FetchError extends StackerError {
  constructor(remote: string, originalError?: Error) {
    super(
      `Failed to fetch from '${remote}'`,
      "Check your network connection and that the remote exists.",
      originalError
    );
    this.name = "FetchError";
  }
}

/**
 * Merge base not found
 */
export class MergeBaseError extends StackerError {
  constructor(ref1: string, ref2: string, originalError?: Error) {
    super(
      `Could not find common ancestor between '${ref1}' and '${ref2}'`,
      "Make sure both refs exist and share history.",
      originalError
    );
    this.name = "MergeBaseError";
  }
}

/**
 * Commit not found
 */
export class CommitNotFoundError extends StackerError {
  constructor(sha: string, originalError?: Error) {
    super(
      `Commit '${sha}' not found`,
      "Make sure the commit exists in this repository.",
      originalError
    );
    this.name = "CommitNotFoundError";
  }
}

/**
 * PR creation failed
 */
export class PRCreationError extends StackerError {
  constructor(branch: string, reason: string, originalError?: Error) {
    super(
      `Failed to create PR for branch '${branch}': ${reason}`,
      undefined,
      originalError
    );
    this.name = "PRCreationError";
  }
}

/**
 * PR update failed
 */
export class PRUpdateError extends StackerError {
  constructor(prNumber: number, originalError?: Error) {
    super(
      `Failed to update PR #${prNumber}`,
      "Check that the PR exists and you have permission to edit it.",
      originalError
    );
    this.name = "PRUpdateError";
  }
}

/**
 * PR merge failed
 */
export class PRMergeError extends StackerError {
  constructor(prNumber: number, originalError?: Error) {
    const msg = originalError?.message || "";
    let suggestion = "Check that the PR is mergeable.";
    
    if (msg.includes("protected branch") || msg.includes("required")) {
      suggestion = "The branch has protection rules. Ensure all requirements are met.";
    } else if (msg.includes("conflict")) {
      suggestion = "The PR has merge conflicts. Resolve them first.";
    }
    
    super(
      `Failed to merge PR #${prNumber}`,
      suggestion,
      originalError
    );
    this.name = "PRMergeError";
  }
}

/**
 * GitHub API error
 */
export class GitHubAPIError extends StackerError {
  constructor(operation: string, originalError?: Error) {
    const msg = originalError?.message || "";
    let suggestion = "Check your network connection and try again.";
    
    if (msg.includes("401") || msg.includes("auth")) {
      suggestion = "Run `gh auth login` to re-authenticate.";
    } else if (msg.includes("403") || msg.includes("permission")) {
      suggestion = "Check your repository permissions.";
    } else if (msg.includes("404")) {
      suggestion = "The requested resource was not found.";
    } else if (msg.includes("rate limit")) {
      suggestion = "GitHub API rate limit exceeded. Wait and try again.";
    }
    
    super(
      `GitHub API error during ${operation}`,
      suggestion,
      originalError
    );
    this.name = "GitHubAPIError";
  }
}
