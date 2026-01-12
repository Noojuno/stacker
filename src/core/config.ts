/**
 * Configuration loading and management
 * 
 * Loads configuration from .stacker.toml in the repo root
 * or from the path specified by STACKER_CONFIG env var
 */

import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";
import type { Config } from "../types";

/** Default configuration values */
const DEFAULT_CONFIG: Config = {
  common: {
    verbose: false,
    hyperlinks: true,
  },
  repo: {
    remote: "origin",
    target: "main",
    reviewers: [],
  },
  stack: {
    branchTemplate: "$BRANCH/stack/$ID",
  },
};

/** Find the git repository root */
async function findRepoRoot(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Find the config file path */
async function findConfigPath(): Promise<string | null> {
  // Check environment variable first
  const envPath = process.env["STACKER_CONFIG"];
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // Look for .stacker.toml in repo root
  const repoRoot = await findRepoRoot();
  if (repoRoot) {
    const configPath = path.join(repoRoot, ".stacker.toml");
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/** Deep merge two objects */
function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideValue = override[key];
    const baseValue = base[key];

    if (
      overrideValue !== undefined &&
      typeof overrideValue === "object" &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(
        baseValue as object,
        overrideValue as object
      ) as T[keyof T];
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue as T[keyof T];
    }
  }

  return result;
}

/** Cached config */
let cachedConfig: Config | null = null;

/**
 * Load configuration, merging with defaults
 */
export async function loadConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = await findConfigPath();

  if (!configPath) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = TOML.parse(content) as Partial<Config>;
    cachedConfig = deepMerge(DEFAULT_CONFIG, parsed);
    return cachedConfig;
  } catch (error) {
    console.warn(`Warning: Failed to parse config file: ${configPath}`);
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

/**
 * Clear the cached config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get the repo root directory
 */
export { findRepoRoot };
