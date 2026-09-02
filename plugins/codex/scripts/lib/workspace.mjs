import fs from "node:fs";
import path from "node:path";

function resolvesToGitDirectory(candidatePath) {
  const candidateStats = fs.statSync(candidatePath);
  if (candidateStats.isDirectory()) {
    return true;
  }
  if (!candidateStats.isFile()) {
    return false;
  }

  const match = /^gitdir: (.+?)(?:\r?\n|$)/.exec(fs.readFileSync(candidatePath, "utf8"));
  if (!match) {
    return false;
  }
  const target = path.resolve(path.dirname(candidatePath), match[1]);
  return fs.statSync(target).isDirectory();
}

function findMarkerWorkspace(canonicalCwd) {
  const cwdStats = fs.statSync(canonicalCwd);
  let current = cwdStats.isFile() ? path.dirname(canonicalCwd) : canonicalCwd;

  while (true) {
    try {
      if (resolvesToGitDirectory(path.join(current, ".git"))) {
        return fs.realpathSync.native(current);
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolveWorkspaceRoot(cwd, env = process.env) {
  try {
    const canonicalCwd = fs.realpathSync.native(cwd);
    const markerWorkspace = findMarkerWorkspace(canonicalCwd);

    if (env?.GIT_WORK_TREE) {
      try {
        const configuredWorkTree = path.resolve(cwd, env.GIT_WORK_TREE);
        const configuredGitDirectory = env.GIT_DIR ? path.resolve(cwd, env.GIT_DIR) : null;
        const hasRepository = configuredGitDirectory
          ? resolvesToGitDirectory(configuredGitDirectory)
          : Boolean(markerWorkspace);
        if (hasRepository && fs.statSync(configuredWorkTree).isDirectory()) {
          return fs.realpathSync.native(configuredWorkTree);
        }
      } catch {
        // Invalid Git environment overrides do not suppress normal marker discovery.
      }
    }

    return markerWorkspace ?? cwd;
  } catch {
    return cwd;
  }
}
