import fs from "node:fs";
import path from "node:path";

export function resolveWorkspaceRoot(cwd) {
  try {
    const canonicalCwd = fs.realpathSync.native(cwd);
    const cwdStats = fs.statSync(canonicalCwd);
    let current = cwdStats.isFile() ? path.dirname(canonicalCwd) : canonicalCwd;

    while (true) {
      try {
        const markerPath = path.join(current, ".git");
        const markerStats = fs.statSync(markerPath);
        const validGitFile = markerStats.isFile() && /^gitdir: \S/.test(fs.readFileSync(markerPath, "utf8"));
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
