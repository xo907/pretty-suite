import { Archive, Bomb, Database, Ghost, LayoutDashboard, MessagesSquare, Radio, Server, Trash2 } from 'lucide-react';
import { fmtNumber, fmtTime, useFetch } from '../api.js';
import { Card, Empty, PageHeader, Stat, cx } from '../ui.jsx';

const ACTIONS = [
  { id: 'purge', icon: Trash2, title: 'Purge messages', text: 'Delete your messages with surgical filters.' },
  { id: 'archive', icon: Archive, title: 'Archive conversations', text: 'Save DMs and channels to your local vault.' },
  { id: 'logger', icon: Radio, title: 'Start live logger', text: 'Capture messages, edits and deletions as they happen.' },
  { id: 'nuke', icon: Bomb, title: 'Nuke everything', text: 'Erase every message you have ever sent.', danger: true },
];

const STATUS_TONE = { done: 'text-emerald-300', running: 'text-accent-300', failed: 'text-red-300', cancelled: 'text-zinc-500', interrupted: 'text-amber-300' };

function jobSummary(job) {
  const s = job.stats;
  if (job.type === 'archive') return `${fmtNumber(s.saved)} saved`;
  if (s.dryRun) return `${fmtNumber(s.estimated)} matching`;
  return `${fmtNumber(s.deleted)} deleted`;
}

export default function Overview({ state, jobs, go }) {
  const { data } = useFetch('/api/vault/insights', [jobs.filter((j) => j.status === 'done').length]);
  const totals = data?.totals;

  return (
    <>
      <PageHeader icon={LayoutDashboard} title={`Welcome back, ${state.user.name}`} subtitle="Your Discord footprint at a glance." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat icon={Server} label="Servers" value={fmtNumber(state.counts.guilds)} />
        <Stat icon={MessagesSquare} label="Open DMs" value={fmtNumber(state.counts.dms)} />
        <Stat icon={Database} label="Messages in vault" value={fmtNumber(totals?.messages)} />
        <Stat icon={Ghost} label="Deletions caught" value={fmtNumber(totals?.deleted)} hint="by the live logger" />
        <Stat icon={Radio} label="Live logger" value={state.logger.status === 'connected' ? 'On' : 'Off'} hint={`${fmtNumber(state.logger.captured)} this session`} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => go(action.id)}
            className={cx(
              'card rise group cursor-pointer p-5 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.06]',
              action.danger && 'hover:border-red-500/40'
            )}
          >
            <action.icon className={cx('size-5', action.danger ? 'text-red-400' : 'text-accent-300')} />
            <div className="mt-3 text-sm font-semibold">{action.title}</div>
            <div className="mt-1 text-xs text-zinc-500">{action.text}</div>
          </button>
        ))}
      </div>

      <Card title="Recent activity" className="mt-6">
        {jobs.length === 0 ? (
          <Empty title="Nothing yet">Scans, purges and archives you run will show up here.</Empty>
        ) : (
          <div className="divide-y divide-white/6">
            {jobs.slice(0, 8).map((job) => (
              <div key={job.id} className="flex items-center gap-4 py-2.5 text-sm">
                <span className="w-20 font-medium">{job.label || job.type}</span>
                <span className={cx('w-24 text-xs capitalize', STATUS_TONE[job.status])}>{job.status}</span>
                <span className="flex-1 text-xs text-zinc-400">{jobSummary(job)}</span>
                <span className="text-xs text-zinc-600">{fmtTime(job.created)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
