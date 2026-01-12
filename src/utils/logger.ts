/**
 * Logging utilities with color support
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  
  // Foreground
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
} as const;

type ColorName = keyof typeof colors;

/** Apply color to text */
function colorize(text: string, ...colorNames: ColorName[]): string {
  const prefix = colorNames.map((c) => colors[c]).join("");
  return `${prefix}${text}${colors.reset}`;
}

/** Logger instance with methods for different log levels */
export const logger = {
  /** Standard info message */
  info(message: string): void {
    console.log(message);
  },

  /** Success message (green) */
  success(message: string): void {
    console.log(colorize(`✓ ${message}`, "green"));
  },

  /** Warning message (yellow) */
  warn(message: string): void {
    console.log(colorize(`⚠ ${message}`, "yellow"));
  },

  /** Error message (red) */
  error(message: string): void {
    console.error(colorize(`✗ ${message}`, "red"));
  },

  /** Debug message (gray, only shown in verbose mode) */
  debug(message: string, verbose = false): void {
    if (verbose) {
      console.log(colorize(`  ${message}`, "gray"));
    }
  },

  /** Section header (bold) */
  header(message: string): void {
    console.log(colorize(`\n${message}`, "bold"));
  },

  /** Dimmed text for secondary information */
  dim(message: string): void {
    console.log(colorize(message, "dim"));
  },

  /** Format a commit SHA (short, colored) */
  sha(sha: string): string {
    return colorize(sha.slice(0, 8), "yellow");
  },

  /** Format a PR number */
  pr(number: number | undefined): string {
    if (number === undefined) {
      return colorize("(new)", "dim");
    }
    return colorize(`#${number}`, "cyan");
  },

  /** Format a branch name */
  branch(name: string): string {
    return colorize(name, "magenta");
  },

  /** Print a blank line */
  blank(): void {
    console.log();
  },

  /** Print a horizontal rule */
  rule(char = "─", length = 50): void {
    console.log(colorize(char.repeat(length), "dim"));
  },
};

/** Colors for external use */
export { colorize, colors };
