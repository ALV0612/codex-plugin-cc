import test from "node:test";
import assert from "node:assert/strict";

import { readStdinIfPiped } from "../plugins/codex/scripts/lib/fs.mjs";

function scriptedRead(steps, events = []) {
  return (fd, buffer, offset, length, position) => {
    events.push(["read", fd, offset, length, position]);
    const step = steps.shift();
    if (step instanceof Error) throw step;
    if (step == null) return 0;
    const bytes = Buffer.from(step);
    bytes.copy(buffer, offset);
    return bytes.length;
  };
}

function transient(code = "EAGAIN") {
  return Object.assign(new Error("resource temporarily unavailable"), { code });
}

test("readStdinIfPiped preserves bytes consumed before a transient read failure", () => {
  const events = [];
  const input = readStdinIfPiped({
    stdin: { isTTY: false, _handle: { setBlocking: (value) => events.push(["blocking", value]) } },
    readSync: scriptedRead(["first-", transient(), "second\n", null], events),
    waitForRetry: (delay) => events.push(["wait", delay]),
    chunkSize: 32
  });
  assert.equal(input, "first-second\n");
  assert.deepEqual(events[0], ["blocking", true]);
  assert.deepEqual(events.filter((event) => event[0] === "wait"), [["wait", 10]]);
});

test("readStdinIfPiped treats EWOULDBLOCK as transient and bounds backoff", () => {
  const error = transient("EWOULDBLOCK");
  const waits = [];
  assert.throws(() => readStdinIfPiped({
    stdin: { isTTY: false },
    readSync() { throw error; },
    waitForRetry: (delay) => waits.push(delay),
    maxAttempts: 5,
    initialRetryDelayMs: 10,
    maxRetryDelayMs: 25
  }), (actual) => actual === error);
  assert.deepEqual(waits, [10, 20, 25, 25]);
});

test("readStdinIfPiped surfaces non-transient read errors without retrying", () => {
  const error = Object.assign(new Error("bad descriptor"), { code: "EBADF" });
  let waits = 0;
  assert.throws(() => readStdinIfPiped({
    stdin: { isTTY: false },
    readSync() { throw error; },
    waitForRetry() { waits += 1; }
  }), (actual) => actual === error);
  assert.equal(waits, 0);
});

test("readStdinIfPiped ignores unsupported blocking mode and reads all chunks", () => {
  const input = readStdinIfPiped({
    stdin: { isTTY: false, _handle: { setBlocking() { throw new Error("unsupported"); } } },
    readSync: scriptedRead(["ordinary ", "pipe", null]),
    waitForRetry() { throw new Error("unexpected retry"); }
  });
  assert.equal(input, "ordinary pipe");
});

test("readStdinIfPiped returns empty input for a TTY without touching fd 0", () => {
  let reads = 0;
  const input = readStdinIfPiped({
    stdin: { isTTY: true },
    readSync() { reads += 1; return 0; }
  });
  assert.equal(input, "");
  assert.equal(reads, 0);
});
