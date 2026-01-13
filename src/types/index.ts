/**
 * Core type definitions for Stacker
 */

/** Parsed commit with trailers */
export interface Commit {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  trailers: Map<string, string>;
}

/** A single entry in a stack (one commit = one PR) */
export interface StackEntry {
  commit: Commit;
  prNumber?: number;
  prUrl?: string;
  branchName: string;
  targetBranch: string;
}

/** Information about a dependency on another stack */
export interface StackDependency {
  stackName: string;
  topBranch: string;
  prNumber?: number;
  autoDetected: boolean;
}

/** A complete stack of PRs */
export interface Stack {
  name: string;
  entries: StackEntry[];
  target: string;
  dependsOn?: StackDependency;
}

/** Rebase action for the edit command */
export interface RebaseAction {
  type: "pick" | "edit" | "reword" | "squash" | "drop";
  sha: string;
  subject: string;
}

/** PR status from GitHub */
export interface PRStatus {
  number: number;
  mergeable: boolean;
  mergeStateStatus: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
}

/** Configuration file structure */
export interface Config {
  common: {
    verbose: boolean;
    hyperlinks: boolean;
  };
  repo: {
    remote: string;
    target: string;
    reviewers: string[];
  };
  stack: {
    branchTemplate: string;
  };
}

/** Global CLI options available to all commands */
export interface GlobalOptions {
  remote: string;
  base?: string;
  head: string;
  target: string;
  verbose: boolean;
}

/** Options for the submit command */
export interface SubmitOptions extends GlobalOptions {
  draft: boolean;
  reviewer?: string;
  keepBody: boolean;
}

/** Options for the edit command */
export interface EditOptions extends GlobalOptions {
  continue?: boolean;
  abort?: boolean;
}

/** Options for the amend command */
export interface AmendOptions {
  message?: string;
  edit?: boolean;
}

/** Options for the land command */
export interface LandOptions extends GlobalOptions {
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
}
