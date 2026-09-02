import { readJobFile, resolveJobFile, upsertJob, writeJobFile } from "./state.mjs";
import { nowIso } from "./tracked-jobs.mjs";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function persistSpawnFailure(workspaceRoot, jobId, error) {
  const message = errorMessage(error);
  const completedAt = nowIso();
  let existing = { id: jobId };
  try {
    existing = readJobFile(resolveJobFile(workspaceRoot, jobId));
  } catch {
    // Preserve the launch error even if the prepublished record cannot be reread.
  }
  const failedRecord = {
    ...existing,
    id: jobId,
    status: "failed",
    phase: "failed",
    pid: null,
    errorMessage: message,
    completedAt
  };
  writeJobFile(workspaceRoot, jobId, failedRecord);
  upsertJob(workspaceRoot, {
    id: jobId,
    status: "failed",
    phase: "failed",
    pid: null,
    errorMessage: message,
    completedAt
  });
}

function awaitSpawn(child) {
  if (!child || typeof child.once !== "function") {
    return Promise.reject(new Error("Detached task worker did not return a child process."));
  }

  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off?.("error", onError);
      resolve(child);
    };
    const onError = (error) => {
      child.off?.("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

export async function dispatchBackgroundJob({ job, request, logFile, spawnWorker }) {
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    request
  };

  // The worker's first operation is to read this record, so publish it before
  // process creation. The worker owns the later running transition and PID.
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  let child;
  try {
    child = spawnWorker();
    await awaitSpawn(child);
    if (!Number.isFinite(child.pid)) {
      throw new Error("Detached task worker spawned without a process ID.");
    }
    child.unref?.();
  } catch (error) {
    persistSpawnFailure(job.workspaceRoot, job.id, error);
    throw error;
  }

  return {
    jobId: job.id,
    status: "queued",
    title: job.title,
    summary: job.summary,
    logFile
  };
}
