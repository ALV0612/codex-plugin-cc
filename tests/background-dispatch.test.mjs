import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dispatchBackgroundJob } from "../plugins/codex/scripts/lib/background-dispatch.mjs";
import { makeTempDir } from "./helpers.mjs";
import {
  listJobs,
  readJobFile,
  resolveJobFile,
  upsertJob,
  writeJobFile
} from "../plugins/codex/scripts/lib/state.mjs";

function createJob(workspaceRoot) {
  return {
    id: "task-ordering-test",
    kind: "task",
    kindLabel: "rescue",
    title: "Codex Task",
    workspaceRoot,
    jobClass: "task",
    summary: "ordering test",
    write: false,
    createdAt: "2026-09-02T00:00:00.000Z"
  };
}

function fakeChild(schedule, pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unrefCalled = false;
  child.unref = () => {
    child.unrefCalled = true;
  };
  process.nextTick(() => schedule(child));
  return child;
}

test("dispatchBackgroundJob publishes the complete request before spawning", async () => {
  const workspace = makeTempDir();
  const job = createJob(workspace);
  const request = { cwd: workspace, prompt: "inspect the race", write: false };
  const logFile = path.join(workspace, "task.log");
  fs.writeFileSync(logFile, "queued\n", "utf8");
  let observedAtSpawn = null;
  let child = null;

  const payload = await dispatchBackgroundJob({
    job,
    request,
    logFile,
    spawnWorker() {
      observedAtSpawn = readJobFile(resolveJobFile(workspace, job.id));
      child = fakeChild((value) => value.emit("spawn"));
      return child;
    }
  });

  assert.equal(observedAtSpawn.status, "queued");
  assert.equal(observedAtSpawn.pid, null);
  assert.deepEqual(observedAtSpawn.request, request);
  assert.equal(observedAtSpawn.logFile, logFile);
  assert.equal(payload.jobId, job.id);
  assert.equal(payload.status, "queued");
  assert.equal(child.unrefCalled, true);
  assert.equal(listJobs(workspace)[0].status, "queued");
});

test("dispatchBackgroundJob never regresses a worker-authored running record", async () => {
  const workspace = makeTempDir();
  const job = createJob(workspace);
  const request = { cwd: workspace, prompt: "run immediately", write: false };
  const logFile = path.join(workspace, "task.log");
  fs.writeFileSync(logFile, "queued\n", "utf8");

  await dispatchBackgroundJob({
    job,
    request,
    logFile,
    spawnWorker() {
      const queued = readJobFile(resolveJobFile(workspace, job.id));
      const running = {
        ...queued,
        status: "running",
        phase: "starting",
        pid: 4242,
        startedAt: "2026-09-02T00:00:01.000Z"
      };
      writeJobFile(workspace, job.id, running);
      upsertJob(workspace, running);
      return fakeChild((value) => value.emit("spawn"));
    }
  });

  const stored = readJobFile(resolveJobFile(workspace, job.id));
  assert.equal(stored.status, "running");
  assert.equal(stored.pid, 4242);
  assert.equal(listJobs(workspace)[0].status, "running");
  assert.equal(listJobs(workspace)[0].pid, 4242);
});

test("dispatchBackgroundJob persists a terminal failure when spawn fails", async () => {
  const workspace = makeTempDir();
  const job = createJob(workspace);
  const request = { cwd: workspace, prompt: "cannot spawn", write: false };
  const logFile = path.join(workspace, "task.log");
  fs.writeFileSync(logFile, "queued\n", "utf8");

  await assert.rejects(
    dispatchBackgroundJob({
      job,
      request,
      logFile,
      spawnWorker() {
        return fakeChild((value) => value.emit("error", new Error("spawn denied")));
      }
    }),
    /spawn denied/
  );

  const stored = readJobFile(resolveJobFile(workspace, job.id));
  const indexed = listJobs(workspace)[0];
  for (const record of [stored, indexed]) {
    assert.equal(record.status, "failed");
    assert.equal(record.phase, "failed");
    assert.equal(record.pid, null);
    assert.equal(record.errorMessage, "spawn denied");
    assert.ok(record.completedAt);
  }
});


test("dispatchBackgroundJob rejects a spawn acknowledgement without a process ID", async () => {
  const workspace = makeTempDir();
  const job = createJob(workspace);
  const request = { cwd: workspace, prompt: "missing pid", write: false };
  const logFile = path.join(workspace, "task.log");
  fs.writeFileSync(logFile, "queued\n", "utf8");

  await assert.rejects(
    dispatchBackgroundJob({
      job,
      request,
      logFile,
      spawnWorker() {
        return fakeChild((value) => value.emit("spawn"), Number.NaN);
      }
    }),
    /spawned without a process ID/
  );

  const stored = readJobFile(resolveJobFile(workspace, job.id));
  assert.equal(stored.status, "failed");
  assert.equal(stored.pid, null);
  assert.match(stored.errorMessage, /without a process ID/);
});
