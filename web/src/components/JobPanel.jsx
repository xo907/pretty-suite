import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleSlash, Hourglass, Loader2, Pause, Play, RotateCw, Square, XCircle } from 'lucide-react';
import { api, fmtNumber, fmtTime } from '../api.js';
import { cx } from '../ui.jsx';

const STATUS = {
  running: { label: 'Running', icon: Loader2, className: 'text-accent-300', spin: true },
  done: { label: 'Complete', icon: CheckCircle2, className: 'text-emerald-300' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-red-300' },
  cancelled: { label: 'Cancelled', icon: CircleSlash, className: 'text-zinc-400' },
  // A restart caught it mid-run; it continues by itself once its account is connected again.
  interrupted: { label: 'Waiting to resume', icon: Hourglass, className: 'text-amber-300' },
};
const LEVELS = { info: 'text-zinc-400', warn: 'text-amber-300', error: 'text-red-300', success: 'text-emerald-300' };

function progressOf(job) {
  const s = job.stats;
  if (job.status === 'done') return 1;
  if (s.progress !== undefined) return s.progress;
  if (job.type === 'archive') return s.channelsTotal ? s.channelsDone / s.channelsTotal : 0;
  if (s.dryRun || !s.estimated) return s.targetsTotal ? s.targetsDone / s.targetsTotal : 0;
  return Math.min(1, (s.deleted + s.skipped + s.failed) / s.estimated);
}

function duration(ms) {
  const minutes = Math.round(ms / 60000);
  if (ms < 45000) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 48) return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `${Math.round(minutes / 1440)} days`;
}

/** Re-renders once a second while `on`, so the time left counts down between updates from the server. */
function useTick(on) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [on]);
}

function timeLeft(job, now) {
  if (job.status === 'interrupted') return 'Continues from here once the account is connected again';
  if (job.status !== 'running') return job.finished ? `Took ${duration(job.finished - job.created)}` : '';
  if (job.paused) return 'Paused';
  // Jobs that never finish say what they are waiting for instead.
  if (job.stats.endless) {
    const next = job.stats.next && job.stats.next > now ? ` · next session in ${duration(job.stats.next - now)}` : '';
    return `${job.stats.nextWhat || 'Running'}${next}`;
  }
  if (!job.eta) return 'Working out how long is left…';
  if (job.eta - now < 5000) return 'Almost done';
  return `About ${duration(job.eta - now)} left · done around ${fmtTime(job.eta)}`;
}

function figures(job) {
  const s = job.stats;
  if (s.items) return s.items; // jobs that describe their own figures
  if (/^(ig|rd)-/.test(job.type)) return [];
  if (job.type === 'archive') {
    return [['Saved', s.saved], ['Scanned', s.scanned], ['Files', s.files], ['Channels', `${s.channelsDone ?? 0}/${s.channelsTotal ?? 0}`]];
  }
  if (s.dryRun) return [['Matching', s.estimated], ['Scanned', `${s.targetsDone ?? 0}/${s.targetsTotal ?? 0}`]];
  return [['Deleted', s.deleted], ['Found', s.estimated], ['Skipped', s.skipped], ['Failed', s.failed]];
}

export default function JobPanel({ job, tone = 'violet' }) {
  return job ? <Panel job={job} tone={tone} /> : null;
}

function Panel({ job, tone }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.log.length]);
  const status = STATUS[job.paused ? 'running' : job.status] || STATUS.running;
  const Icon = job.paused ? Pause : status.icon;
  const control = (action) => api.post(`/api/jobs/${job.id}/${action}`);
  const percent = Math.round(progressOf(job) * 100);
  useTick(job.status === 'running' && !job.paused);

  return (
    <section className="card rise overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <Icon className={cx('size-4', status.className, status.spin && !job.paused && 'animate-spin')} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {job.label || job.type} <span className={cx('ml-1 font-normal', status.className)}>{job.paused ? 'Paused' : status.label}</span>
          </div>
          <div className="truncate text-xs text-zinc-500">{job.stats.current ? `Working on ${job.stats.current}` : `Started ${fmtTime(job.created)}`}</div>
        </div>
        {job.resumable && (
          <button className="btn btn-ghost px-3 py-1.5 text-xs" title="Carry on from the point it had reached" onClick={() => control('retry')}>
            <RotateCw className="size-3.5" /> Resume
          </button>
        )}
        {job.status === 'interrupted' && (
          <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => control('cancel')}>
            <Square className="size-3.5" /> Stop
          </button>
        )}
        {job.status === 'running' && (
          <div className="flex gap-2">
            <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => control(job.paused ? 'resume' : 'pause')}>
              {job.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {job.paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => control('cancel')}>
              <Square className="size-3.5" /> Stop
            </button>
          </div>
        )}
      </div>

      <div className="px-5 pt-4">
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${percent}%`,
              background: tone === 'red' ? '#f87171' : 'var(--color-accent-400)',
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between gap-3 text-[11.5px] text-zinc-500">
          <span className="tabular-nums">{job.stats.endless ? `${percent}% of today's plan` : `${percent}%`}</span>
          <span className="truncate">{timeLeft(job, Date.now())}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 px-5 py-4">
        {figures(job).map(([label, value]) => (
          <div key={label}>
            <div className="font-display text-xl font-medium tabular-nums">{typeof value === 'string' ? value : fmtNumber(value)}</div>
            <div className="text-[11.5px] text-zinc-500">{label}</div>
          </div>
        ))}
      </div>

      {job.log.length > 0 && (
        <div ref={logRef} className="max-h-44 overflow-y-auto border-t border-white/[0.07] px-5 py-3 font-mono text-[11.5px] leading-relaxed">
          {job.log.map((line, i) => (
            <div key={i} className={LEVELS[line.level]}>
              <span className="mr-2 text-zinc-600">{new Date(line.t).toLocaleTimeString()}</span>
              {line.msg}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
