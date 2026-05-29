import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./git.js";

export interface CommitInfo {
  hash: string;
  subject: string;
  date: string;
}

export interface PublishResult {
  commit: string;
  deployedTo: string;
}

/**
 * A single tenant's static site, stored as a git working tree.
 *
 * - `draft`     = the working tree the agent edits (uncommitted changes).
 * - `published` = the last content copied to the served directory.
 *
 * git is the whole versioning/undo story: every publish is a commit, "verni kak bylo"
 * is a forward `git revert`, and history is `git log`.
 */
export class TenantRepo {
  /** Working tree directory (contains `.git`). */
  readonly workdir: string;
  /** Directory the published site is served from, if configured. */
  readonly publishDir?: string;

  constructor(workdir: string, publishDir?: string) {
    this.workdir = path.resolve(workdir);
    this.publishDir = publishDir ? path.resolve(publishDir) : undefined;
  }

  /** Create a fresh tenant working tree from a template directory and make the initial commit. */
  static async initFromTemplate(
    workdir: string,
    templateDir: string,
    publishDir?: string,
  ): Promise<TenantRepo> {
    const abs = path.resolve(workdir);
    await fs.mkdir(abs, { recursive: true });
    await copyDir(path.resolve(templateDir), abs);
    const repo = new TenantRepo(abs, publishDir);
    await git(abs, ["init", "-q", "-b", "main"]);
    await git(abs, ["add", "-A"]);
    await git(abs, ["commit", "-q", "-m", "Initial site from template"]);
    return repo;
  }

  /** Open an existing working tree (must already be a git repo). */
  static open(workdir: string, publishDir?: string): TenantRepo {
    return new TenantRepo(workdir, publishDir);
  }

  async isDirty(): Promise<boolean> {
    const { stdout } = await git(this.workdir, ["status", "--porcelain"]);
    return stdout.trim().length > 0;
  }

  async headCommit(): Promise<string> {
    const { stdout } = await git(this.workdir, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  /** Stage everything and commit. Returns the new commit hash, or null if nothing changed. */
  async commit(message: string): Promise<string | null> {
    await git(this.workdir, ["add", "-A"]);
    if (!(await this.isDirty()) && !(await this.hasStaged())) return null;
    if (!(await this.hasStaged())) return null;
    await git(this.workdir, ["commit", "-q", "-m", message]);
    return this.headCommit();
  }

  private async hasStaged(): Promise<boolean> {
    // Exit code 1 from `diff --cached --quiet` means there are staged changes.
    try {
      await git(this.workdir, ["diff", "--cached", "--quiet"]);
      return false;
    } catch {
      return true;
    }
  }

  async log(limit = 50): Promise<CommitInfo[]> {
    const { stdout } = await git(this.workdir, [
      "log",
      `-n${limit}`,
      "--pretty=format:%H%x09%cI%x09%s",
    ]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split("\t");
        return { hash: hash!, date: date ?? "", subject: rest.join("\t") };
      });
  }

  /** Discard all uncommitted draft changes — back to the last commit ("отмени"). */
  async revertDraft(): Promise<void> {
    await git(this.workdir, ["checkout", "--", "."]);
    await git(this.workdir, ["clean", "-fd"]);
  }

  /**
   * Restore the site content to a past commit by forward-reverting everything after it
   * ("верни как было"). History is preserved; the restore is itself a new commit.
   */
  async rollbackTo(commitHash: string): Promise<string> {
    await git(this.workdir, [
      "revert",
      "--no-commit",
      `${commitHash}..HEAD`,
    ]);
    await git(this.workdir, [
      "commit",
      "-q",
      "-m",
      `Roll back to ${commitHash.slice(0, 8)}`,
    ]);
    return this.headCommit();
  }

  /**
   * Publish the current draft: commit any pending changes, then atomically copy the
   * committed tree into the served directory.
   */
  async publish(message = "Publish"): Promise<PublishResult> {
    if (!this.publishDir) {
      throw new Error("TenantRepo has no publishDir configured");
    }
    await this.commit(message);
    const commit = await this.headCommit();
    await this.exportTo(this.publishDir);
    return { commit, deployedTo: this.publishDir };
  }

  /** Copy the working tree (excluding `.git`) into `dest`, replacing it atomically-ish. */
  async exportTo(dest: string): Promise<void> {
    const destAbs = path.resolve(dest);
    const staging = `${destAbs}.staging-${process.pid}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await copyDir(this.workdir, staging);
    const backup = `${destAbs}.old-${process.pid}`;
    let hadOld = false;
    try {
      await fs.rename(destAbs, backup);
      hadOld = true;
    } catch {
      /* dest didn't exist yet */
    }
    await fs.rename(staging, destAbs);
    if (hadOld) await fs.rm(backup, { recursive: true, force: true });
  }
}

/** Recursively copy a directory, skipping the `.git` metadata folder. */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}
