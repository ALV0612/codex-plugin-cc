import fs from "node:fs";
import path from "node:path";

export function resolveWorkspaceRoot(cwd, env = process.env) {
  try {
    if (env?.GIT_DIR && env?.GIT_WORK_TREE) {
      try {
        const configuredGitDirectory = path.resolve(cwd, env.GIT_DIR);
        const configuredWorkTree = path.resolve(cwd, env.GIT_WORK_TREE);
        if (fs.statSync(configuredGitDirectory).isDirectory() && fs.statSync(configuredWorkTree).isDirectory()) {
          return fs.realpathSync.native(configuredWorkTree);
        }
      } catch {
        // Invalid Git environment overrides do not suppress normal marker discovery.
      }
    }

    const canonicalCwd = fs.realpathSync.native(cwd);
    const cwdStats = fs.statSync(canonicalCwd);
    let current = cwdStats.isFile() ? path.dirname(canonicalCwd) : canonicalCwd;

    while (true) {
      try {
        const markerPath = path.join(current, ".git");
        const markerStats = fs.statSync(markerPath);
        let validGitFile = false;
        if (markerStats.isFile()) {
          const match = /^gitdir: (.+?)(?:\r?\n|$)/.exec(fs.readFileSync(markerPath, "utf8"));
          if (match) {
            const gitDirectory = path.resolve(current, match[1]);
            validGitFile = fs.statSync(gitDirectory).isDirectory();
          }
        }
        if (markerStats.isDirectory() || validGitFile) {
          return fs.realpathSync.native(current);
        }
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
          throw error;
        }
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return cwd;
      }
      current = parent;
    }
  } catch {
    return cwd;
  }
}
