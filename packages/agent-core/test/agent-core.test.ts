import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox, SandboxError } from "../src/sandbox.js";
import { TenantRepo } from "../src/tenant-repo.js";
import { createTools } from "../src/tools.js";

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../templates/starter",
);

async function tmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("Sandbox allows in-root paths and rejects escapes", () => {
  const sb = new Sandbox("/srv/tenants/acme");
  assert.equal(sb.resolve("index.html"), "/srv/tenants/acme/index.html");
  assert.equal(sb.resolve("css/styles.css"), "/srv/tenants/acme/css/styles.css");
  assert.throws(() => sb.resolve("../evil.html"), SandboxError);
  assert.throws(() => sb.resolve("../../etc/passwd"), SandboxError);
  assert.throws(() => sb.resolve("/etc/passwd"), SandboxError);
  assert.throws(() => sb.resolve(".git/config"), SandboxError);
});

test("initFromTemplate creates a committed git repo", async () => {
  const work = await tmp("acms-init-");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  assert.ok((await fs.stat(path.join(work, ".git"))).isDirectory());
  assert.ok((await fs.stat(path.join(work, "index.html"))).isFile());
  const log = await repo.log();
  assert.equal(log.length, 1);
  assert.equal(await repo.isDirty(), false);
});

test("tools: fs_write + edit, commit, publish copies tree without .git", async () => {
  const work = await tmp("acms-pub-");
  const publishDir = path.join(work, "..", path.basename(work) + "-published");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR, publishDir);
  const sandbox = new Sandbox(work);
  const { execute } = createTools({ sandbox, repo });

  const w = await execute("fs_write", JSON.stringify({ path: "about.html", content: "<h1>About</h1>" }));
  assert.match(w, /^OK/);

  const e = await execute(
    "fs_edit",
    JSON.stringify({ path: "index.html", old_string: "Добро пожаловать", new_string: "Привет" }),
  );
  assert.match(e, /^OK/);

  await repo.commit("change");
  const res = await repo.publish("publish");
  assert.ok(res.commit.length >= 7);

  // Published dir has the files but not the git metadata.
  assert.ok((await fs.stat(path.join(publishDir, "about.html"))).isFile());
  const idx = await fs.readFile(path.join(publishDir, "index.html"), "utf8");
  assert.match(idx, /Привет/);
  await assert.rejects(fs.stat(path.join(publishDir, ".git")));
});

test("tools: fs_edit rejects non-unique old_string without replace_all", async () => {
  const work = await tmp("acms-edit-");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  const sandbox = new Sandbox(work);
  const { execute } = createTools({ sandbox, repo });
  // "Краткое описание." appears 3 times in the template.
  const r = await execute(
    "fs_edit",
    JSON.stringify({ path: "index.html", old_string: "Краткое описание.", new_string: "X" }),
  );
  assert.match(r, /not unique/);
});

test("tools: fs_edit accepts replace_all sent as the string \"false\"", async () => {
  const work = await tmp("acms-coerce-");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  const sandbox = new Sandbox(work);
  const { execute } = createTools({ sandbox, repo });
  // Models often stringify booleans; this must not be rejected on a type technicality.
  const r = await execute(
    "fs_edit",
    JSON.stringify({
      path: "index.html",
      old_string: "Добро пожаловать",
      new_string: "Привет",
      replace_all: "false",
    }),
  );
  assert.match(r, /^OK/);
});

test("tools: path traversal is blocked at the tool layer", async () => {
  const work = await tmp("acms-trav-");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  const sandbox = new Sandbox(work);
  const { execute } = createTools({ sandbox, repo });
  const r = await execute("fs_read", JSON.stringify({ path: "../../../etc/passwd" }));
  assert.match(r, /^ERROR/);
});

test("revertDraft discards uncommitted edits", async () => {
  const work = await tmp("acms-revert-");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  const sandbox = new Sandbox(work);
  const { execute } = createTools({ sandbox, repo });
  await execute("fs_write", JSON.stringify({ path: "index.html", content: "broken" }));
  assert.equal(await repo.isDirty(), true);
  await repo.revertDraft();
  assert.equal(await repo.isDirty(), false);
  const idx = await fs.readFile(path.join(work, "index.html"), "utf8");
  assert.match(idx, /Добро пожаловать/);
});

test("rollbackTo restores content from a past version", async () => {
  const work = await tmp("acms-rollback-");
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  const sandbox = new Sandbox(work);
  const { execute } = createTools({ sandbox, repo });

  const v0 = await repo.headCommit();
  await execute("fs_write", JSON.stringify({ path: "index.html", content: "<h1>v1</h1>" }));
  await repo.commit("v1");
  assert.match(await fs.readFile(path.join(work, "index.html"), "utf8"), /v1/);

  await repo.rollbackTo(v0);
  assert.match(await fs.readFile(path.join(work, "index.html"), "utf8"), /Добро пожаловать/);
  // History preserved: v0, v1, rollback = 3 commits.
  assert.equal((await repo.log()).length, 3);
});
