import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { readStdinIfPiped } from "../plugins/codex/scripts/lib/fs.mjs";

function readOptions(overrides = {}) {
  return {
    stdin: { isTTY: false },
    readFileSync() {
      return "piped prompt";
    },
    waitForRetry() {
      throw new Error("unexpected retry wait");
    },
    ...overrides
  };
}

test("readStdinIfPiped recovers when a non-blocking read is transiently unavailable", (context) => {
  const transientError = Object.assign(new Error("resource temporarily unavailable"), {
    code: "EAGAIN"
  });
  const events = [];
  let reads = 0;

  context.mock.method(fs, "readFileSync", (fd, encoding) => {
    events.push(["read", fd, encoding]);
    reads += 1;
    if (reads === 1) {
      throw transientError;
    }
    return "deterministic piped prompt";
  });

  const input = readStdinIfPiped({
    stdin: {
      isTTY: false,
      _handle: {
        setBlocking(value) {
          events.push(["setBlocking", value]);
        }
      }
    },
    waitForRetry(delayMs) {
      events.push(["wait", delayMs]);
    }
  });

  assert.equal(input, "deterministic piped prompt");
  assert.deepEqual(events, [
    ["setBlocking", true],
    ["read", 0, "utf8"],
    ["wait", 10],
    ["read", 0, "utf8"]
  ]);
});

test("readStdinIfPiped treats EWOULDBLOCK as transient and bounds backoff", () => {
  const transientError = Object.assign(new Error("would block"), {
    code: "EWOULDBLOCK"
  });
  const waits = [];
  let reads = 0;

  assert.throws(
    () =>
      readStdinIfPiped(
        readOptions({
          readFileSync() {
            reads += 1;
            throw transientError;
          },
          waitForRetry(delayMs) {
            waits.push(delayMs);
          },
          maxAttempts: 5,
          initialRetryDelayMs: 10,
          maxRetryDelayMs: 25
        })
      ),
    (error) => error === transientError
  );
  assert.equal(reads, 5);
  assert.deepEqual(waits, [10, 20, 25, 25]);
});

test("readStdinIfPiped surfaces non-transient read errors without retrying", () => {
  const readError = Object.assign(new Error("bad descriptor"), { code: "EBADF" });
  let reads = 0;

  assert.throws(
    () =>
      readStdinIfPiped(
        readOptions({
          readFileSync() {
            reads += 1;
            throw readError;
          }
        })
      ),
    (error) => error === readError
  );
  assert.equal(reads, 1);
});

test("readStdinIfPiped ignores unsupported blocking mode and reads the pipe", () => {
  let reads = 0;
  const input = readStdinIfPiped(
    readOptions({
      stdin: {
        isTTY: false,
        _handle: {
          setBlocking() {
            throw new Error("not supported");
          }
        }
      },
      readFileSync(fd, encoding) {
        reads += 1;
        assert.equal(fd, 0);
        assert.equal(encoding, "utf8");
        return "ordinary pipe";
      }
    })
  );

  assert.equal(input, "ordinary pipe");
  assert.equal(reads, 1);
});

test("readStdinIfPiped returns empty input for a TTY without touching fd 0", () => {
  let setBlockingCalls = 0;

  const input = readStdinIfPiped(
    readOptions({
      stdin: {
        isTTY: true,
        _handle: {
          setBlocking() {
            setBlockingCalls += 1;
          }
        }
      },
      readFileSync() {
        throw new Error("TTY stdin must not be read");
      }
    })
  );

  assert.equal(input, "");
  assert.equal(setBlockingCalls, 0);
});
