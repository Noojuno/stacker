/**
 * Edit TUI - Interactive commit editor for rebase operations
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  type KeyEvent,
} from "@opentui/core";
import type { Stack, StackEntry, RebaseAction } from "../types";

type ActionType = "pick" | "edit" | "reword" | "drop";

interface EditEntry {
  entry: StackEntry;
  action: ActionType;
}

/**
 * Get color for action type
 */
function getActionColor(action: ActionType): string {
  switch (action) {
    case "pick":
      return "#00AA00";
    case "edit":
      return "#FFAA00";
    case "reword":
      return "#00AAFF";
    case "drop":
      return "#FF4444";
    default:
      return "#FFFFFF";
  }
}

/**
 * Format an edit entry for display
 */
function formatEditEntry(entry: EditEntry, index: number): string {
  const num = String(index + 1).padStart(2, " ");
  const sha = entry.entry.commit.shortSha;
  const action = `[${entry.action}]`.padEnd(8);
  const subject = entry.entry.commit.subject.slice(0, 35);
  return `${num}  ${sha}  ${action}  ${subject}`;
}

/**
 * Run the edit TUI
 * Returns the rebase actions to perform, or null if cancelled
 */
export async function runEditTUI(stack: Stack): Promise<RebaseAction[] | null> {
  return new Promise(async (resolve) => {
    const renderer = await createCliRenderer();

    // Initialize edit entries with 'pick' action
    const editEntries: EditEntry[] = stack.entries.map((entry) => ({
      entry,
      action: "pick" as ActionType,
    }));

    // Build initial options
    const buildOptions = () =>
      editEntries.map((entry, i) => ({
        name: formatEditEntry(entry, i),
        description: `Action: ${entry.action}`,
      }));

    // Main container
    const container = new BoxRenderable(renderer, {
      id: "container",
      width: "100%",
      height: "100%",
      borderStyle: "single",
      borderColor: "#444444",
      title: ` Edit Stack: ${stack.name} `,
      titleAlignment: "left",
      flexDirection: "column",
      padding: 1,
    });

    // Help bar at top
    const helpText =
      "e: edit  r: reword  d: drop  p: pick  Enter: execute  q: cancel";
    const helpBar = new TextRenderable(renderer, {
      id: "help",
      content: helpText,
      fg: "#888888",
    });

    // Commit list
    const commitList = new SelectRenderable(renderer, {
      id: "commits",
      options: buildOptions(),
      width: "100%",
      height: Math.min(stack.entries.length + 2, 15),
      selectedBackgroundColor: "#333366",
    });

    // Status bar at bottom
    const statusBar = new TextRenderable(renderer, {
      id: "status",
      content: "Select commits and set actions, then press Enter to execute",
      fg: "#666666",
    });

    container.add(helpBar);
    container.add(commitList);
    container.add(statusBar);
    renderer.root.add(container);

    commitList.focus();

    let isExiting = false;

    // Helper to update the list display
    const updateList = () => {
      const newOptions = buildOptions();
      // SelectRenderable doesn't have a direct update method,
      // so we need to rebuild - for now just re-render
      renderer.requestRender();
    };

    // Get current selected index
    const getSelectedIndex = (): number => {
      return (commitList as unknown as { selectedIndex: number }).selectedIndex ?? 0;
    };

    // Set action for current entry
    const setAction = (action: ActionType) => {
      const idx = getSelectedIndex();
      const entry = editEntries[idx];
      if (entry) {
        entry.action = action;
        // Update the option name to reflect new action
        const options = buildOptions();
        // Unfortunately SelectRenderable doesn't support dynamic updates easily
        // We'll need to work around this
        statusBar.content = `Set commit ${entry.entry.commit.shortSha} to ${action}`;
      }
    };

    renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (isExiting) return;

      const idx = getSelectedIndex();

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        isExiting = true;
        renderer.destroy();
        resolve(null);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        isExiting = true;
        renderer.destroy();

        // Build rebase actions
        const actions: RebaseAction[] = editEntries.map((e) => ({
          type: e.action,
          sha: e.entry.commit.sha,
          subject: e.entry.commit.subject,
        }));
        resolve(actions);
        return;
      }

      // Action keys
      if (key.name === "e") {
        setAction("edit");
      } else if (key.name === "r") {
        setAction("reword");
      } else if (key.name === "d") {
        setAction("drop");
      } else if (key.name === "p") {
        setAction("pick");
      }
    });

    renderer.start();
  });
}

/**
 * Generate a git rebase-todo file from actions
 */
export function generateRebaseTodo(actions: RebaseAction[]): string {
  const lines: string[] = [];

  for (const action of actions) {
    // Git rebase uses short action names
    const actionName = action.type === "drop" ? "drop" : action.type;
    lines.push(`${actionName} ${action.sha.slice(0, 7)} ${action.subject}`);
  }

  return lines.join("\n");
}

/**
 * Simple text-based edit prompt (fallback)
 */
export function printEditHelp(): void {
  console.log();
  console.log("\x1b[1mEdit Mode\x1b[0m");
  console.log();
  console.log("To edit commits in your stack:");
  console.log("  1. Use 'stacker edit' to launch the interactive editor");
  console.log("  2. Select commits and assign actions (edit, reword, drop)");
  console.log("  3. Press Enter to execute the rebase");
  console.log();
  console.log("If a rebase is in progress:");
  console.log("  - Make your changes");
  console.log("  - Run 'stacker amend' to amend the current commit");
  console.log("  - Run 'stacker edit --continue' to continue");
  console.log("  - Run 'stacker edit --abort' to abort");
  console.log();
}
