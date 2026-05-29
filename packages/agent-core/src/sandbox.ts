import path from "node:path";

/**
 * Confines all file operations to a single tenant root directory.
 *
 * The editing agent is given arbitrary-code freedom *inside* one tenant's site,
 * but must never read or write outside it. Every path the model supplies is
 * resolved and checked against the root before any fs access happens.
 */
export class Sandbox {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Resolve a model-supplied relative path to an absolute path inside the root.
   * Throws on absolute paths, traversal (`..`), or anything escaping the root.
   */
  resolve(relPath: string): string {
    if (typeof relPath !== "string" || relPath.length === 0) {
      throw new SandboxError("path must be a non-empty string");
    }
    if (path.isAbsolute(relPath)) {
      throw new SandboxError(`absolute paths are not allowed: ${relPath}`);
    }
    const abs = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, abs);
    if (rel === "" ) {
      // resolves to the root itself — allowed for listing, not for file ops
      return abs;
    }
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new SandboxError(`path escapes tenant root: ${relPath}`);
    }
    // Disallow touching the git metadata directory.
    const top = rel.split(path.sep)[0];
    if (top === ".git") {
      throw new SandboxError(".git is read-only to the agent");
    }
    return abs;
  }
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}
