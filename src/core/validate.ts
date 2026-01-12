/**
 * Validation functions to check prerequisites before running commands
 */

import { exec } from "../utils/exec";
import {
  NotInGitRepoError,
  NoCommitsError,
  NoRemoteError,
  GhCliNotInstalledError,
  GhNotAuthenticatedError,
} from "../utils/errors";
import { commandExists } from "../utils/exec";

/**
 * Check if we're inside a git repository
 */
export async function validateGitRepo(): Promise<void> {
  try {
    await exec("git rev-parse --git-dir");
  } catch (error) {
    throw new NotInGitRepoError(error instanceof Error ? error : undefined);
  }
}

/**
 * Check if the repository has at least one commit
 */
export async function validateHasCommits(): Promise<void> {
  try {
    const result = await exec("git rev-parse HEAD", { ignoreExitCode: true });
    if (result.exitCode !== 0) {
      // Check if the error is about HEAD not existing
      if (
        result.stderr.includes("ambiguous argument 'HEAD'") ||
        result.stderr.includes("unknown revision")
      ) {
        throw new NoCommitsError();
      }
      throw new NoCommitsError(new Error(result.stderr));
    }
  } catch (error) {
    if (error instanceof NoCommitsError) {
      throw error;
    }
    // Check the error message for common patterns
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("ambiguous argument 'HEAD'") ||
      message.includes("unknown revision")
    ) {
      throw new NoCommitsError(error instanceof Error ? error : undefined);
    }
    throw error;
  }
}

/**
 * Check if a remote exists
 */
export async function validateRemoteExists(remote: string): Promise<void> {
  try {
    const result = await exec(`git remote get-url ${remote}`, {
      ignoreExitCode: true,
    });
    if (result.exitCode !== 0) {
      throw new NoRemoteError(remote);
    }
  } catch (error) {
    if (error instanceof NoRemoteError) {
      throw error;
    }
    throw new NoRemoteError(
      remote,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Check if GitHub CLI is installed
 */
export async function validateGhCliInstalled(): Promise<void> {
  const hasGh = await commandExists("gh");
  if (!hasGh) {
    throw new GhCliNotInstalledError();
  }
}

/**
 * Check if GitHub CLI is authenticated
 */
export async function validateGhAuthenticated(): Promise<void> {
  try {
    const result = await exec("gh auth status", { ignoreExitCode: true });
    if (result.exitCode !== 0) {
      throw new GhNotAuthenticatedError(new Error(result.stderr));
    }
  } catch (error) {
    if (error instanceof GhNotAuthenticatedError) {
      throw error;
    }
    throw new GhNotAuthenticatedError(
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Combined validation for GitHub CLI
 */
export async function validateGhCli(): Promise<void> {
  await validateGhCliInstalled();
  await validateGhAuthenticated();
}

/**
 * Options for prerequisite validation
 */
export interface ValidateOptions {
  /** Check that we're in a git repo (default: true) */
  requireGitRepo?: boolean;
  /** Check that the repo has commits (default: false) */
  requireCommits?: boolean;
  /** Check that the remote exists (default: false) */
  requireRemote?: string | boolean;
  /** Check that gh CLI is installed and authenticated (default: false) */
  requireGh?: boolean;
}

/**
 * Validate all prerequisites for a command
 */
export async function validatePrerequisites(
  options: ValidateOptions = {}
): Promise<void> {
  const {
    requireGitRepo = true,
    requireCommits = false,
    requireRemote = false,
    requireGh = false,
  } = options;

  // Always check git repo first
  if (requireGitRepo) {
    await validateGitRepo();
  }

  // Check for commits
  if (requireCommits) {
    await validateHasCommits();
  }

  // Check for remote
  if (requireRemote) {
    const remoteName =
      typeof requireRemote === "string" ? requireRemote : "origin";
    await validateRemoteExists(remoteName);
  }

  // Check gh CLI
  if (requireGh) {
    await validateGhCli();
  }
}
