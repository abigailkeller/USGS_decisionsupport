// Runs the app's R steps as private, short-lived jobs so several people can
// use the app at once without seeing or overwriting each other's data.
//
// The browser holds each user's data (model inputs, posterior samples,
// results) and sends what a step needs when it starts one. The server writes
// those inputs to a folder named by a random job ID, runs the R script(s)
// there, and hands back the outputs; the folder is deleted once the browser
// has collected them. Nothing is kept on the server between steps.
//
// Jobs run one (or JOB_CONCURRENCY) at a time, in the order they were
// started: a model fit uses all 4 CPU cores and ~10 GB of memory, so two at
// once would run out of memory. Others wait in a queue and see their place.
//
// Job types
//   fit       catch/effort rows -> model inputs, posterior samples and the
//             posterior summary (prep_model_data.R, run_model.R,
//             create_posterior_summary.R)
//   analyze   model inputs + posterior -> simulated dynamics
//             (simulate_dynamics.R, or the fit's still-running process)
//   optimize  model inputs + posterior + settings -> trap schedule
//             (optimize_traps.R)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const JOBS_DIR = path.join(ROOT, 'data', 'jobs');
const CONCURRENCY = Math.max(1, Number(process.env.JOB_CONCURRENCY) || 1);
// a queued or running job nobody has checked on for this long was abandoned
// (tab closed), so it's cancelled to free its place
const ABANDONED_MS = 10 * 60 * 1000;
// finished jobs whose outputs were never collected are deleted after this
const FINISHED_TTL_MS = 60 * 60 * 1000;
// a fit's process is kept alive briefly so "Analyze results" can reuse its
// compiled model instead of recompiling
const PARKED_TTL_MS = 20 * 60 * 1000;

const jobs = new Map(); // id -> job
const queue = []; // ids of queued jobs, oldest first
let running = 0;
// fit job id -> { child, parkedAt }: fit processes waiting for an ANALYZE
const parked = new Map();

// Every job folder belongs to a previous server run whose processes are
// gone, so start clean. A browser still polling one of those jobs gets "not
// found" and tells the user the run was interrupted.
fs.rmSync(JOBS_DIR, { recursive: true, force: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

const newId = () => crypto.randomBytes(16).toString('hex');
const isJobId = (id) => /^[0-9a-f]{32}$/.test(id);

class JobError extends Error {}

// ---- creating and tracking jobs ----

// `steps(job)` is an async function that does the work in job.dir and
// returns the result object handed back to the browser. `reuseFitId`: the
// fit whose parked process this job will use (kept alive when it starts).
function createJob(type, steps, { reuseFitId = null } = {}) {
  const id = newId();
  const job = {
    id,
    type,
    dir: path.join(JOBS_DIR, id),
    status: 'queued',
    steps,
    reuseFitId,
    progress: null, // latest progress from the R script, or our own
    error: null,
    result: null,
    child: null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    finishedAt: null,
  };
  fs.mkdirSync(job.dir, { recursive: true });
  jobs.set(id, job);
  queue.push(id);
  startQueued();
  return job;
}

function startQueued() {
  while (running < CONCURRENCY && queue.length) {
    const job = jobs.get(queue.shift());
    if (!job || job.status !== 'queued') continue;
    running += 1;
    job.status = 'running';
    // a parked fit process holds several GB; free it unless this job is the
    // analysis that will reuse it
    releaseParked(job.reuseFitId);
    job.steps(job)
      .then((result) => { job.result = result; job.status = 'done'; })
      .catch((error) => {
        if (job.status === 'cancelled') return;
        job.status = 'failed';
        job.error = error instanceof JobError ? error.message : `Unexpected error: ${error.message}`;
      })
      .finally(() => {
        job.child = null;
        job.finishedAt = Date.now();
        running -= 1;
        startQueued();
      });
  }
}

function cancelJob(job) {
  if (job.status === 'queued' || job.status === 'running') {
    job.status = 'cancelled';
    const index = queue.indexOf(job.id);
    if (index >= 0) queue.splice(index, 1);
    killTree(job.child);
  }
  removeJob(job);
}

function removeJob(job) {
  jobs.delete(job.id);
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  // started detached, so the R process leads its own group (incl. workers)
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }
}

function releaseParked(keepFitId) {
  for (const [fitId, entry] of parked) {
    if (fitId === keepFitId) continue;
    killTree(entry.child);
    parked.delete(fitId);
  }
}

// housekeeping: abandoned jobs, uncollected results, idle parked processes
setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    const active = job.status === 'queued' || job.status === 'running';
    if (active && now - job.lastSeen > ABANDONED_MS) cancelJob(job);
    else if (!active && job.finishedAt && now - job.finishedAt > FINISHED_TTL_MS) removeJob(job);
  }
  for (const [fitId, entry] of parked) {
    if (now - entry.parkedAt > PARKED_TTL_MS) { killTree(entry.child); parked.delete(fitId); }
  }
}, 60 * 1000).unref();

// ---- running R ----

function readProgress(progressPath) {
  try { return JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch (error) { return null; }
}

// last lines of an R error, without the noise
function tail(text, lines = 4) {
  return String(text || '').trim().split('\n').slice(-lines).join('\n');
}

// Runs an R script to completion. Progress written by the script to
// `progressPath` is reported as the job's progress. Rejects with the
// script's reported error, or the end of its error output.
function runR(job, args, { progressPath } = {}) {
  return new Promise((resolve, reject) => {
    if (job.status === 'cancelled') return reject(new JobError('Cancelled.'));
    let stderr = '';
    const child = spawn('Rscript', args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    const timer = progressPath ? setInterval(() => {
      const progress = readProgress(progressPath);
      if (progress) job.progress = progress;
    }, 1000) : null;
    child.on('error', (error) => { if (timer) clearInterval(timer); reject(new JobError(`Could not start R: ${error.message}`)); });
    child.on('exit', (code) => {
      if (timer) clearInterval(timer);
      const progress = progressPath ? readProgress(progressPath) : null;
      if (progress) job.progress = progress;
      if (job.status === 'cancelled') return reject(new JobError('Cancelled.'));
      if (progress && progress.error) return reject(new JobError(progress.error));
      if (code !== 0) return reject(new JobError(tail(stderr) || `R exited with code ${code}.`));
      resolve(stdout);
    });
  });
}

// The model fit's process stays alive after sampling, waiting on stdin for
// an ANALYZE command (so the analysis can reuse its compiled model). So the
// fit is finished when its progress file says done, not when it exits.
function runFitProcess(job, args, progressPath) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn('Rscript', args, { cwd: ROOT, detached: true, stdio: ['pipe', 'ignore', 'pipe'] });
    child.stdin.on('error', () => {}); // ignore EPIPE if it exits first
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    job.child = child;
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearInterval(timer); fn(value); } };
    const timer = setInterval(() => {
      const progress = readProgress(progressPath);
      if (!progress) return;
      job.progress = progress;
      if (progress.done && progress.error) { killTree(child); finish(reject, new JobError(progress.error)); }
      else if (progress.done) finish(resolve, child);
    }, 1000);
    child.on('exit', (code) => {
      if (job.status === 'cancelled') return finish(reject, new JobError('Cancelled.'));
      const progress = readProgress(progressPath);
      if (progress && progress.done && !progress.error) return finish(resolve, child);
      finish(reject, new JobError((progress && progress.error) || tail(stderr)
        || (code === null ? 'The model run was stopped (it may have run out of memory).' : `The model run exited with code ${code}.`)));
    });
  });
}

// Hands one analysis to a fit's kept-alive process (which then exits) and
// waits for it to finish.
function runReusedAnalysis(job, child, command, progressPath) {
  return new Promise((resolve, reject) => {
    job.child = child;
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearInterval(timer); fn(value); } };
    const timer = setInterval(() => {
      const progress = readProgress(progressPath);
      if (progress) job.progress = progress;
    }, 1000);
    child.on('exit', () => {
      if (job.status === 'cancelled') return finish(reject, new JobError('Cancelled.'));
      const progress = readProgress(progressPath);
      if (progress) job.progress = progress;
      if (progress && progress.done && !progress.error) return finish(resolve);
      finish(reject, new JobError((progress && progress.error) || 'The analysis stopped unexpectedly.'));
    });
    child.stdin.write(command);
  });
}

// stops a fit's kept-alive process, e.g. when that user's data changes
function releaseFit(fitId) {
  const entry = parked.get(fitId);
  if (entry) { killTree(entry.child); parked.delete(fitId); }
}

// ---- inputs and outputs ----

function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, base64] of Object.entries(files || {})) {
    if (!/^[\w.-]+\.rds$/.test(name)) throw new JobError(`Unexpected model input file "${name}".`);
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(base64), 'base64'));
  }
}

function readFilesBase64(dir) {
  const files = {};
  for (const name of fs.readdirSync(dir)) files[name] = fs.readFileSync(path.join(dir, name)).toString('base64');
  return files;
}

function requireBase64(value, label) {
  if (typeof value !== 'string' || !value.length) throw new JobError(`Missing ${label}. Run the earlier steps again.`);
  return value;
}

// ---- HTTP ----

// GET /api/jobs/:id - where the job is
function jobStatus(job) {
  const base = { id: job.id, type: job.type, status: job.status, done: job.status === 'done' || job.status === 'failed' };
  if (job.status === 'queued') {
    const ahead = queue.indexOf(job.id) + running;
    return {
      ...base,
      phase: 'queued',
      completed: 0,
      total: 0,
      message: ahead > 0
        ? `Waiting for ${ahead} other run${ahead === 1 ? '' : 's'} to finish before this one starts...`
        : 'Starting...',
      error: null,
    };
  }
  const p = job.progress || {};
  return {
    ...base,
    phase: job.status === 'done' ? 'done' : (p.phase || 'preparing'),
    completed: p.completed || 0,
    total: p.total || 0,
    message: p.message || '',
    error: job.status === 'failed' ? job.error : null,
  };
}

module.exports = { createJob, cancelJob, removeJob, jobs, isJobId, jobStatus, runR, runFitProcess, runReusedAnalysis, releaseFit, writeFiles, readFilesBase64, requireBase64, readProgress, parked, JobError };
