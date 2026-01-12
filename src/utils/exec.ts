/**
 * Shell command execution utilities using Bun.spawn
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  /** If true, don't throw on non-zero exit code */
  ignoreExitCode?: boolean;
}

/**
 * Execute a shell command and return the result
 */
export async function exec(
  command: string,
  options: ExecOptions = {}
): Promise<ExecResult> {
  const { cwd, env, timeout = 60000, ignoreExitCode = false } = options;

  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set up timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
    }, timeout);
  });

  // Wait for process to complete or timeout
  const [exitCode, stdout, stderr] = await Promise.race([
    Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]),
    timeoutPromise,
  ]);

  const result: ExecResult = {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };

  if (!ignoreExitCode && exitCode !== 0) {
    const error = new Error(
      `Command failed with exit code ${exitCode}: ${command}\n${stderr || stdout}`
    );
    (error as Error & { result: ExecResult }).result = result;
    throw error;
  }

  return result;
}

/**
 * Execute a command and return just stdout (convenience wrapper)
 */
export async function execStdout(
  command: string,
  options: ExecOptions = {}
): Promise<string> {
  const result = await exec(command, options);
  return result.stdout;
}

/**
 * Check if a command exists
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    await exec(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}
