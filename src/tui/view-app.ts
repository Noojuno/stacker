/**
 * View TUI - Interactive stack viewer using OpenTUI
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type SelectRenderableEvents,
  type KeyEvent,
} from "@opentui/core";
import type { Stack, StackEntry } from "../types";
import { openPRInBrowser } from "../core/github";

interface ViewTUIOptions {
  stack: Stack;
  onEdit?: () => Promise<void>;
  onSubmit?: () => Promise<void>;
  onLand?: () => Promise<void>;
}

/**
 * Format a stack entry for display in the list
 */
function formatEntry(entry: StackEntry, index: number): string {
  const num = String(index + 1).padStart(2, " ");
  const sha = entry.commit.shortSha;
  const pr = entry.prNumber ? `#${entry.prNumber}`.padEnd(6) : "(new) ";
  const subject = entry.commit.subject.slice(0, 40);
  return `${num}  ${sha}  ${pr}  ${subject}`;
}

/**
 * Run the view TUI
 */
export async function runViewTUI(options: ViewTUIOptions): Promise<void> {
  const { stack, onEdit, onSubmit, onLand } = options;

  const renderer = await createCliRenderer();

  // Main container
  const container = new BoxRenderable(renderer, {
    id: "container",
    width: "100%",
    height: "100%",
    borderStyle: "single",
    borderColor: "#444444",
    title: ` Stack: ${stack.name} `,
    titleAlignment: "left",
    flexDirection: "column",
    padding: 1,
  });

  // Header with target info
  const headerText = stack.dependsOn
    ? `Target: ${stack.target}  |  Depends on: ${stack.dependsOn.stackName}`
    : `Target: ${stack.target}`;

  const header = new TextRenderable(renderer, {
    id: "header",
    content: headerText,
    fg: "#888888",
  });

  // Stack entries list
  const entryOptions = stack.entries.map((entry, i) => ({
    name: formatEntry(entry, i),
    description: entry.targetBranch,
  }));

  // Show empty state if no entries
  if (entryOptions.length === 0) {
    entryOptions.push({
      name: "  (no commits in stack range)",
      description: "",
    });
  }

  const stackList = new SelectRenderable(renderer, {
    id: "stack-list",
    options: entryOptions,
    width: "100%",
    height: Math.min(stack.entries.length + 2, 15),
    selectedBackgroundColor: "#333366",
  });

  // Help bar
  const helpText =
    "q: Quit  ↵: Open PR  e: Edit  s: Submit  l: Land";
  const helpBar = new TextRenderable(renderer, {
    id: "help",
    content: helpText,
    fg: "#666666",
  });

  // Add components to container
  container.add(header);
  container.add(stackList);
  container.add(helpBar);
  renderer.root.add(container);

  // Focus the list for keyboard navigation
  stackList.focus();

  // Track if we're exiting
  let isExiting = false;

  // Handle keyboard events
  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    if (isExiting) return;

    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      isExiting = true;
      renderer.destroy();
      process.exit(0);
    }

    if (key.name === "return" || key.name === "enter") {
      // Open selected PR in browser
      const selectedIndex = (stackList as unknown as { selectedIndex: number }).selectedIndex ?? 0;
      const entry = stack.entries[selectedIndex];
      if (entry?.prNumber) {
        await openPRInBrowser(entry.prNumber);
      }
    }

    if (key.name === "e" && onEdit) {
      isExiting = true;
      renderer.destroy();
      await onEdit();
    }

    if (key.name === "s" && onSubmit) {
      isExiting = true;
      renderer.destroy();
      await onSubmit();
    }

    if (key.name === "l" && onLand) {
      isExiting = true;
      renderer.destroy();
      await onLand();
    }
  });

  // Start the renderer
  renderer.start();

  // Keep process alive
  await new Promise(() => {});
}

/**
 * Simple text-based view (fallback if TUI not available)
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
