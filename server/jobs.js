import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { broadcast } from './events.js';
import { Cancelled, HttpError, sleep } from './util.js';

for (const column of ['label TEXT', 'log TEXT', 'state TEXT', 'paused INTEGER', 'owner TEXT']) {
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN ${column}`);
  } catch {
    // Already added by an earlier run.
  }
}
// Anything still marked running belongs to a previous run of the app. Demo accounts do not outlive it.
db.prepare("UPDATE jobs SET status = 'cancelled', finished = ? WHERE status = 'running' AND owner = 'demo'").run(Date.now());

const active = new Map();
const kinds = new Map();
const persist = db.prepare(
  'INSERT OR REPLACE INTO jobs (id, type, status, config, stats, created, finished, label, log, state, paused, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

/**
 * Registers how a job type runs.
 *   run(ctx, config)  does the work.
 *   account()         id of the connected account it acts on ('demo' for a demo, null when none is connected).
 *   revive(config)    rebuilds whatever could not be stored with the config (optional).
 */
export function defineJob(type, { run, account, revive = (config) => config }) {
  kinds.set(type, { run, account, revive });
}

/** The whole job is written in one go, so a restart can pick it up from exactly this point. */
function save(job) {
  job.savedAt = Date.now();
  persist.run(
    job.id,
    job.type,
    job.status,
    JSON.stringify(job.config),
    JSON.stringify(job.stats),
    job.created,
    job.finished,
    job.label,
    JSON.stringify(job.log.slice(-150)),
    JSON.stringify(job.state),
    job.paused ? 1 : 0,
    job.owner
  );
}

const fromRow = (row) => ({
  id: row.id,
  type: row.type,
  label: row.label ?? JSON.parse(row.config || '{}').label,
  status: row.status,
  paused: Boolean(row.paused),
  config: JSON.parse(row.config || '{}'),
  stats: JSON.parse(row.stats || '{}'),
  log: JSON.parse(row.log || '[]'),
  state: JSON.parse(row.state || '{}'),
  created: row.created,
  finished: row.finished,
  owner: row.owner,
});

const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const activeMs = (job) => Date.now() - job.startedAt - job.pausedMs - (job.pausedAt ? Date.now() - job.pausedAt : 0);

/** Remembers when each step of progress was reached (in running time, pauses excluded). */
function track(job) {
  const p = clamp(job.stats.progress);
  const last = job.samples.at(-1);
  if (!p || p === last?.p) return;
  if (last && p < last.p) job.samples = [];
  job.samples.push({ t: activeMs(job), p });
  if (job.samples.length > 30) job.samples.shift();
}

/** Expected finish time, from the pace of the most recent steps. Null until two steps have been seen. */
function eta(job) {
  if (job.status !== 'running' || job.paused || job.stats.endless || !job.samples || job.samples.length < 2) return null;
  const first = job.samples[0];
  const last = job.samples.at(-1);
  if (last.p >= 1 || last.t <= first.t) return null;
  const left = ((1 - last.p) * (last.t - first.t)) / (last.p - first.p) - (activeMs(job) - last.t);
  return Date.now() + Math.max(0, left);
}

const snapshot = (job) => ({
  id: job.id,
  type: job.type,
  label: job.label,
  // Still marked running, but nothing is working on it: it resumes once its account is connected again.
  status: job.status === 'running' && !job.abort ? 'interrupted' : job.status,
  paused: job.paused,
  stats: job.stats,
  eta: eta(job),
  resumable: (job.status === 'failed' || job.status === 'cancelled') && Boolean(job.owner) && kinds.has(job.type),
  log: job.log.slice(-150),
  created: job.created,
  finished: job.finished,
});

function launch(job) {
  const { run, revive } = kinds.get(job.type);
  Object.assign(job, { status: 'running', finished: null, abort: new AbortController(), samples: [], startedAt: Date.now(), pausedMs: 0, pausedAt: job.paused ? Date.now() : null });
  active.set(job.id, job);

  let queued = false;
  const emit = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (job.status === 'running' && Date.now() - job.savedAt > 2000) save(job);
      broadcast('job', snapshot(job));
    }, 120);
  };

  const ctx = {
    signal: job.abort.signal,
    stats: job.stats,
    /** Where the job has got to. Survives restarts: whatever is here when save() is called is what a resumed run starts from. */
    state: job.state,
    log(level, msg) {
      job.log.push({ t: Date.now(), level, msg });
      if (job.log.length > 400) job.log.shift();
      emit();
    },
    update(patch) {
      Object.assign(job.stats, patch);
      track(job);
      emit();
    },
    save(patch) {
      if (patch) Object.assign(job.state, patch);
      save(job);
    },
    async checkpoint() {
      while (job.paused && !job.abort.signal.aborted) await sleep(250);
      if (job.abort.signal.aborted) throw new Cancelled();
    },
    sleep: (ms) => sleep(ms, job.abort.signal),
  };

  (async () => {
    try {
      await run(ctx, revive(job.config));
      job.status = 'done';
    } catch (err) {
      if (err instanceof Cancelled || job.abort.signal.aborted) {
        job.status = 'cancelled';
        ctx.log('warn', 'Cancelled.');
      } else {
        job.status = 'failed';
        ctx.log('error', err.message);
      }
    }
    job.finished = Date.now();
    job.paused = false;
    save(job);
    broadcast('job', snapshot(job));
    // Keep finished jobs in memory for a while, then let the DB row take over.
    setTimeout(() => active.get(job.id) === job && active.delete(job.id), 30 * 60 * 1000).unref();
  })();

  save(job);
  emit();
  return snapshot(job);
}

/** `config` is stored as given, so it must be plain data; see defineJob's `revive` for the rest. */
export function startJob(type, label, config) {
  const kind = kinds.get(type);
  if (!kind) throw new HttpError(400, 'Unknown job type.');
  return launch({
    id: randomUUID().slice(0, 8),
    type,
    label,
    paused: false,
    config,
    stats: {},
    log: [],
    state: {},
    created: Date.now(),
    owner: kind.account(),
  });
}

const stored = (id) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row && fromRow(row);
};

/** Continues every job a restart interrupted, as soon as the account it was running on is connected again. */
export function resumeJobs() {
  for (const { id } of db.prepare("SELECT id FROM jobs WHERE status = 'running' ORDER BY created").all()) {
    if (active.has(id)) continue;
    const job = stored(id);
    const kind = kinds.get(job.type);
    if (!kind || !job.owner || kind.account() !== job.owner) continue;
    job.log.push({ t: Date.now(), level: 'info', msg: 'Pretty Suite was restarted. Picking up where this left off…' });
    launch(job);
  }
}

/** Runs a failed or stopped job again from the point it had reached. */
function retryJob(id) {
  const live = active.get(id);
  if (live?.status === 'running') return false;
  const job = stored(id);
  const kind = job && kinds.get(job.type);
  if (!kind || !job.owner || !['failed', 'cancelled'].includes(job.status)) return false;
  if (kind.account() !== job.owner) throw new HttpError(409, 'Connect the account this was running on first.');
  job.log.push({ t: Date.now(), level: 'info', msg: 'Resuming from where it stopped…' });
  launch(job);
  return true;
}

export function listJobs() {
  const live = [...active.values()].map(snapshot);
  const seen = new Set(live.map((j) => j.id));
  const past = db
    .prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 40')
    .all()
    .filter((row) => !seen.has(row.id))
    .map((row) => snapshot(fromRow(row)));
  return [...live, ...past].sort((a, b) => b.created - a.created);
}

export function controlJob(id, action) {
  if (action === 'retry') return retryJob(id);
  const job = active.get(id);
  if (!job || job.status !== 'running') {
    // Interrupted by a restart and still waiting for its account: stopping it just closes it out.
    const waiting = !job && action === 'cancel' && stored(id);
    if (!waiting || waiting.status !== 'running') return false;
    Object.assign(waiting, { status: 'cancelled', finished: Date.now(), paused: false });
    save(waiting);
    broadcast('job', snapshot(waiting));
    return true;
  }
  if (action === 'pause' && !job.paused) (job.paused = true), (job.pausedAt = Date.now());
  if (action === 'resume' && job.paused) {
    job.pausedMs += Date.now() - job.pausedAt;
    job.pausedAt = null;
    job.paused = false;
  }
  if (action === 'cancel') job.abort.abort();
  else save(job);
  broadcast('job', snapshot(job));
  return true;
}

/** Called on the way out: running jobs stay marked running, with their latest figures, so the next start resumes them. */
export function suspendJobs() {
  for (const job of active.values()) if (job.status === 'running') save(job);
}

export const hasRunningJobs = () => [...active.values()].some((j) => j.status === 'running');
