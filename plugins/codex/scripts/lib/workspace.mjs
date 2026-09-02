import fs from "node:fs";
import path from "node:path";

export function resolveWorkspaceRoot(cwd) {
  try {
    const canonicalCwd = fs.realpathSync.native(cwd);
    const cwdStats = fs.statSync(canonicalCwd);
    let current = cwdStats.isFile() ? path.dirname(canonicalCwd) : canonicalCwd;

    while (true) {
      try {
        const markerStats = fs.lstatSync(path.join(current, ".git"));
        if (markerStats.isDirectory() || markerStats.isFile()) {
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
