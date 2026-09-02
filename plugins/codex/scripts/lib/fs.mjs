import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function ensureAbsolutePath(cwd, maybePath) {
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

export function createTempDir(prefix = "codex-plugin-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function safeReadFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }
  return true;
}

const stdinRetryWaitArray = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function waitForStdinRetry(delayMs) {
  Atomics.wait(stdinRetryWaitArray, 0, 0, delayMs);
}

function isTransientReadError(error) {
  return error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK";
}

export function readStdinIfPiped({
  stdin = process.stdin,
  readFileSync = fs.readFileSync,
  waitForRetry = waitForStdinRetry,
  maxAttempts = 8,
  initialRetryDelayMs = 10,
  maxRetryDelayMs = 500
} = {}) {
  if (stdin.isTTY) {
    return "";
  }

  try {
    Reflect.get(stdin, "_handle")?.setBlocking?.(true);
  } catch {
    // Some stdin handle types do not support changing blocking mode.
  }

  let retryDelayMs = initialRetryDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return readFileSync(0, "utf8");
    } catch (error) {
      if (!isTransientReadError(error) || attempt === maxAttempts) {
        throw error;
      }
      waitForRetry(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs);
    }
  }

  throw new Error("Unreachable stdin read state.");
}
