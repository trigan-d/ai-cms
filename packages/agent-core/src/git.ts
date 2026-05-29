import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

/**
 * Thin async wrapper around the `git` CLI scoped to a working directory.
 * Kept dependency-free on purpose — git is the entire versioning/undo/publish story.
 */
export async function git(cwd: string, args: string[]): Promise<GitResult> {
  const { stdout, stderr } = await pExecFile("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      // Deterministic, non-interactive identity so commits never block on config.
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "ai-cms",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "agent@ai-cms.local",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "ai-cms",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "agent@ai-cms.local",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return { stdout, stderr };
}
