import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { listJobs, readJobFile, resolveJobFile, upsertJob, writeJobFile } from "../plugins/codex/scripts/lib/state.mjs";
import { runTrackedJob } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";

test("runTrackedJob handles an initial running-state write failure before invoking the runner", async () => {
  const workspace = makeTempDir();
  const job = {
    id: "task-initial-write-failure",
    workspaceRoot: workspace,
    title: "Codex Task",
    status: "queued",
    phase: "queued",
    pid: null,
    logFile: path.join(workspace, "task.log")
  };
  fs.writeFileSync(job.logFile, "queued\n", "utf8");
  writeJobFile(workspace, job.id, job);
  upsertJob(workspace, job);

  let writeCalls = 0;
  let runnerCalls = 0;
  await assert.rejects(
    runTrackedJob(
      job,
      async () => {
        runnerCalls += 1;
        return { exitStatus: 0 };
      },
      {
        logFile: job.logFile,
        writeJobFileImpl(cwd, jobId, payload) {
          writeCalls += 1;
          if (writeCalls === 1) {
            throw new Error("initial running write failed");
          }
          return writeJobFile(cwd, jobId, payload);
        }
      }
    ),
    /initial running write failed/
  );

  assert.equal(runnerCalls, 0);
  const stored = readJobFile(resolveJobFile(workspace, job.id));
  assert.equal(stored.status, "failed");
  assert.equal(stored.errorMessage, "initial running write failed");
  assert.equal(listJobs(workspace)[0].status, "failed");
});
