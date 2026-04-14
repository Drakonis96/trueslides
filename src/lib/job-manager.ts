/**
 * Server-side background job manager.
 * Jobs survive browser refresh — they run in the Node.js process until completion or cancellation.
 *
 * Uses globalThis to ensure a single shared Map across all Next.js route modules.
 */

export type JobStatus = "running" | "completed" | "error" | "cancelled";
export type JobType = "presentation" | "notes";

export interface JobProgress {
  percent: number;
  message: string;
}

export interface ProgressLogEntry {
  timestamp: number;
  percent: number;
  message: string;
}

export interface PartialSlideInfo {
  title: string;
  bullets: string[];
  notes: string;
  section?: string;
  imageUrls?: string[];
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  progressLog: ProgressLogEntry[];
  partialSlides: PartialSlideInfo[];
  result?: unknown;
  error?: string;
  title?: string;
  createdAt: number;
  completedAt?: number;
  abortController: AbortController;
}

export interface JobInfo {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  progressLog: ProgressLogEntry[];
  partialSlides: PartialSlideInfo[];
  result?: unknown;
  error?: string;
  title?: string;
  createdAt: number;
  completedAt?: number;
}

// Use globalThis to survive Next.js module re-loading across routes
const _globalKey = "__trueslides_jobs" as const;

declare global {
  // eslint-disable-next-line no-var
  var __trueslides_jobs: Map<string, Job> | undefined;
}

function getJobsMap(): Map<string, Job> {
  if (!globalThis[_globalKey]) {
    globalThis[_globalKey] = new Map<string, Job>();
  }
  return globalThis[_globalKey];
}

export function createJob(id: string, type: JobType, title?: string): Job {
  const jobs = getJobsMap();
  const job: Job = {
    id,
    type,
    status: "running",
    progress: { percent: 0, message: "" },
    progressLog: [{ timestamp: Date.now(), percent: 0, message: "Job created" }],
    partialSlides: [],
    title,
    createdAt: Date.now(),
    abortController: new AbortController(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | null {
  const job = getJobsMap().get(id);
  if (!job) return null;
  return job;
}

export function getJobInfo(job: Job): JobInfo {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    progressLog: job.progressLog,
    partialSlides: job.partialSlides,
    result: job.result,
    error: job.error,
    title: job.title,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export function getAllJobs(): JobInfo[] {
  const result: JobInfo[] = [];
  for (const job of getJobsMap().values()) {
    result.push(getJobInfo(job));
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function updateJobProgress(id: string, percent: number, message: string): void {
  const job = getJobsMap().get(id);
  if (job && job.status === "running") {
    const pct = Math.min(100, percent);
    job.progress = { percent: pct, message };
    // Append to log only when message changes or percent jumps significantly
    const last = job.progressLog[job.progressLog.length - 1];
    if (!last || last.message !== message || Math.abs(last.percent - pct) >= 3) {
      job.progressLog.push({ timestamp: Date.now(), percent: pct, message });
    }
  }
}

/** Update *only* the displayed message & percent — does NOT create a log entry. */
export function updateJobDisplay(id: string, percent: number, message: string): void {
  const job = getJobsMap().get(id);
  if (job && job.status === "running") {
    job.progress = { percent: Math.min(100, percent), message };
  }
}

export function updateJobPartialSlides(id: string, slides: PartialSlideInfo[]): void {
  const job = getJobsMap().get(id);
  if (job && job.status === "running") {
    job.partialSlides = slides;
  }
}

export function completeJob(id: string, result: unknown, title?: string): void {
  const job = getJobsMap().get(id);
  if (job) {
    job.status = "completed";
    job.result = result;
    job.completedAt = Date.now();
    if (title) job.title = title;
    job.progress = { percent: 100, message: "Done" };
    job.progressLog.push({ timestamp: Date.now(), percent: 100, message: "Done" });
  }
}

export function failJob(id: string, error: string): void {
  const job = getJobsMap().get(id);
  if (job) {
    job.status = "error";
    job.error = error;
    job.completedAt = Date.now();
    job.progressLog.push({ timestamp: Date.now(), percent: job.progress.percent, message: `Error: ${error}` });
  }
}

export function cancelJob(id: string): boolean {
  const jobs = getJobsMap();
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status !== "running") return false;
  job.abortController.abort();
  job.status = "cancelled";
  job.completedAt = Date.now();
  return true;
}

// Clean up old completed/failed jobs more aggressively to prevent memory accumulation
/**
 * CLEANUP_INTERVAL: Run cleanup every 30 minutes instead of 1 hour.
 * This prevents accumulation of stale job entries during long sessions.
 */
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

/**
 * MAX_AGE: Keep completed jobs for 6 hours instead of 24 hours.
 * Completed jobs consume server-side memory; older jobs are safely discarded.
 */
const MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

setInterval(() => {
  const jobs = getJobsMap();
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.status !== "running" && job.completedAt && now - job.completedAt > MAX_AGE) {
      jobs.delete(id);
    }
  }
}, CLEANUP_INTERVAL);
