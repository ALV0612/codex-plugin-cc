import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { resolveStateDir } from "../plugins/codex/scripts/lib/state.mjs";
import { resolveWorkspaceRoot } from "../plugins/codex/scripts/lib/workspace.mjs";

function makeNestedWorkspace(gitMarker) {
  const workspace = makeTempDir();
  const nested = path.join(workspace, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });
  if (gitMarker === "directory") {
    fs.mkdirSync(path.join(workspace, ".git"));
  } else {
    const gitDirectory = path.join(workspace, "metadata.git");
    fs.mkdirSync(gitDirectory);
    fs.writeFileSync(path.join(workspace, ".git"), "gitdir: metadata.git\n", "utf8");
  }
  return { workspace: fs.realpathSync.native(workspace), nested };
}

test("resolveWorkspaceRoot honors an environment-configured work tree without a .git marker", () => {
  const worktree = makeTempDir();
  const gitDirectory = makeTempDir();
  const nested = path.join(worktree, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(
    resolveWorkspaceRoot(nested, { GIT_DIR: gitDirectory, GIT_WORK_TREE: "../.." }),
    fs.realpathSync.native(worktree)
  );
});

test("resolveWorkspaceRoot ignores GIT_WORK_TREE without GIT_DIR", () => {
  const outer = makeNestedWorkspace("directory");
  assert.equal(resolveWorkspaceRoot(outer.nested, { GIT_WORK_TREE: "/tmp/unrelated" }), outer.workspace);
});

test("resolveWorkspaceRoot ignores an environment work tree with a missing GIT_DIR", () => {
  const outer = makeNestedWorkspace("directory");
  assert.equal(
    resolveWorkspaceRoot(outer.nested, { GIT_DIR: "missing.git", GIT_WORK_TREE: "../.." }),
    outer.workspace
  );
});

test("resolveWorkspaceRoot discovers a checkout without starting a child process", () => {
  const { workspace, nested } = makeNestedWorkspace("directory");
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = () => {
    throw new Error("workspace resolution must not start a child process");
  };
  syncBuiltinESMExports();

  try {
    assert.equal(resolveWorkspaceRoot(nested), workspace);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }
});

test("resolveWorkspaceRoot accepts a linked-worktree gitfile", () => {
  const { workspace, nested } = makeNestedWorkspace("file");

  assert.equal(resolveWorkspaceRoot(nested), workspace);
});

test("resolveWorkspaceRoot ignores an ordinary file named .git", () => {
  const outer = makeNestedWorkspace("directory");
  const nestedWorkspace = path.join(outer.workspace, "vendor", "not-a-repo");
  const cwd = path.join(nestedWorkspace, "src");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(nestedWorkspace, ".git"), "not a gitfile\n", "utf8");

  assert.equal(resolveWorkspaceRoot(cwd), outer.workspace);
});

for (const invalidMarker of ["gitdir:/tmp/metadata\n", "gitdir:\t/tmp/metadata\n", "metadata\ngitdir: /tmp/metadata\n", "gitdir: missing.git\n"]) {
  test(`resolveWorkspaceRoot rejects malformed gitfile ${JSON.stringify(invalidMarker)}`, () => {
    const outer = makeNestedWorkspace("directory");
    const nestedWorkspace = path.join(outer.workspace, "vendor", "not-a-repo");
    const cwd = path.join(nestedWorkspace, "src");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(nestedWorkspace, ".git"), invalidMarker, "utf8");

    assert.equal(resolveWorkspaceRoot(cwd), outer.workspace);
  });
}

test("resolveWorkspaceRoot follows a symlinked git directory", () => {
  const workspace = makeTempDir();
  const gitDirectory = makeTempDir();
  const nested = path.join(workspace, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });
  fs.symlinkSync(gitDirectory, path.join(workspace, ".git"), process.platform === "win32" ? "junction" : "dir");

  assert.equal(resolveWorkspaceRoot(nested), fs.realpathSync.native(workspace));
});

test("resolveWorkspaceRoot selects the nearest nested working tree", () => {
  const { workspace } = makeNestedWorkspace("directory");
  const nestedWorkspace = path.join(workspace, "vendor", "nested");
  const cwd = path.join(nestedWorkspace, "src");
  fs.mkdirSync(path.join(nestedWorkspace, ".git"), { recursive: true });
  fs.mkdirSync(cwd);

  assert.equal(resolveWorkspaceRoot(cwd), fs.realpathSync.native(nestedWorkspace));
});

test("resolveWorkspaceRoot starts at a file cwd's parent", () => {
  const { workspace, nested } = makeNestedWorkspace("directory");
  const file = path.join(nested, "index.js");
  fs.writeFileSync(file, "export {};\n", "utf8");

  assert.equal(resolveWorkspaceRoot(file), workspace);
});

test("workspace aliases resolve to the same canonical root and state identity", (t) => {
  const { workspace } = makeNestedWorkspace("directory");
  const nested = path.join(workspace, "packages", "app");
  const alias = `${workspace}-alias`;
  try {
    fs.symlinkSync(workspace, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code)) {
      t.skip(`junction creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const aliasedNested = path.join(alias, "packages", "app");

  assert.equal(resolveWorkspaceRoot(aliasedNested), workspace);
  assert.equal(resolveWorkspaceRoot(aliasedNested), resolveWorkspaceRoot(nested));
  assert.equal(resolveStateDir(aliasedNested), resolveStateDir(nested));
});

test("resolveWorkspaceRoot preserves a non-repository cwd", () => {
  const cwd = makeTempDir();

  assert.equal(resolveWorkspaceRoot(cwd), cwd);
});

test("resolveWorkspaceRoot preserves an inaccessible or missing cwd", () => {
  const cwd = path.join(makeTempDir(), "missing", "directory");

  assert.equal(resolveWorkspaceRoot(cwd), cwd);
});
