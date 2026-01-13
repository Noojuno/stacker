#!/usr/bin/env bun
/**
 * Stacker - CLI tool for managing stacked PRs on GitHub
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { viewCommand } from "./commands/view";
import { submitCommand } from "./commands/submit";
import { editCommand } from "./commands/edit";
import { amendCommand } from "./commands/amend";
import { landCommand } from "./commands/land";

const cli = yargs(hideBin(process.argv))
  .scriptName("stacker")
  .usage("$0 <command> [options]")
  .version("0.1.0")

  // Global options
  .option("remote", {
    alias: "R",
    type: "string",
    default: "origin",
    describe: "Remote name",
  })
  .option("base", {
    alias: "B",
    type: "string",
    describe: "Base branch/commit (defaults to merge-base with target)",
  })
  .option("head", {
    alias: "H",
    type: "string",
    default: "HEAD",
    describe: "Head commit",
  })
  .option("target", {
    alias: "T",
    type: "string",
    default: "main",
    describe: "Target branch on remote",
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    default: false,
    describe: "Enable verbose output",
  })

  // Commands
  .command("view", "View current stack of commits and PRs", {}, viewCommand)
  .command(
    "submit",
    "Create or update PRs for the current stack",
    {
      draft: {
        alias: "d",
        type: "boolean",
        default: false,
        describe: "Create PRs as drafts",
      },
      reviewer: {
        type: "string",
        describe: "Comma-separated list of reviewers",
      },
      "keep-body": {
        type: "boolean",
        default: false,
        describe: "Keep existing PR body, only update cross-links",
      },
      "update-title": {
        type: "boolean",
        default: false,
        describe: "Update PR titles from commit subjects",
      },
    },
    submitCommand
  )
  .command(
    "edit",
    "Interactively edit commits in the stack",
    {
      continue: {
        type: "boolean",
        describe: "Continue an in-progress rebase",
      },
      abort: {
        type: "boolean",
        describe: "Abort an in-progress rebase",
      },
    },
    editCommand
  )
  .command(
    "amend",
    "Stage all changes and amend the current commit",
    {
      message: {
        alias: "m",
        type: "string",
        describe: "New commit message",
      },
      edit: {
        type: "boolean",
        describe: "Open editor to edit commit message",
      },
    },
    amendCommand
  )
  .command(
    "land",
    "Merge the bottom PR and rebase the remaining stack",
    {
      all: {
        type: "boolean",
        describe: "Land all PRs in sequence",
      },
      "dry-run": {
        type: "boolean",
        describe: "Show what would be landed without making changes",
      },
      force: {
        alias: "f",
        type: "boolean",
        describe: "Land even if CI checks are failing or pending",
      },
    },
    landCommand
  )
  .command(
    "$0",
    "Show help",
    () => {},
    () => {
      cli.showHelp("log");
    }
  )
  .strict()
  .help()
  .alias("h", "help");

// Parse and run
await cli.parse();
