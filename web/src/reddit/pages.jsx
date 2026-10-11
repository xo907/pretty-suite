import { useEffect, useState } from 'react';
import {
  Archive as ArchiveIcon, ArrowBigUp, Bookmark, ChevronDown, Download, ExternalLink, Eye, EyeOff, KeyRound, LayoutDashboard, Loader2, LogOut, MessageSquare,
  RefreshCw, ScanSearch, Settings as SettingsIcon, ShieldCheck, Sparkles, Trash2, TriangleAlert, Users,
} from 'lucide-react';
import { api, fmtNumber, fmtTime, qs, useFetch } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { Box } from '../components/TargetPicker.jsx';
import { Avatar, Card, Empty, ErrorNote, PageHeader, Segmented, Stat, Toggle, cx } from '../ui.jsx';
import { latestJob, useSelection } from '../instagram/shared.jsx';

const startJob = (type, config) => api.post('/api/rd/jobs', { type, config });
const finished = (jobs) => jobs.filter((j) => j.status !== 'running').length;

// ── Connect ───────────────────────────────────────────────────────────────────────────────────────

export function RdConnect({ onConnected, remote }) {
  const [cookie, setCookie] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [manual, setManual] = useState(Boolean(remote));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const run = async (kind, request) => {
    setBusy(kind);
    setError(null);
    try {
      await request();
      onConnected();
    } catch (err) {
      if (err.message !== 'Login cancelled.') setError(err.message);
    }
    setBusy(null);
  };
  const waiting = busy === 'tab' || busy === 'browser';

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card rise p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full border border-white/[0.09] text-sm font-semibold text-[#ff4500]">R</span>
          <div>
            <div className="text-sm font-semibold">Connect Reddit</div>
            <div className="text-xs text-zinc-500">Log in the way you normally do</div>
          </div>
        </div>

        {waiting ? (
          <div className="rounded-[14px] border border-white/[0.08] p-4 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-accent-300" />
            <div className="mt-2 text-sm font-medium">Waiting for you to log in…</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {busy === 'tab'
                ? 'If your browser asks to allow remote debugging, choose Allow. If you are not logged in to Reddit yet, a new tab opens for it: log in there and it closes by itself.'
                : 'A Reddit window has opened. Log in there.'}{' '}
              This screen continues by itself as soon as you are in.
            </p>
            <button className="btn btn-ghost mt-3 px-3 py-1.5 text-xs" onClick={() => api.post('/api/rd/login/cancel')}>
              Cancel
            </button>
          </div>
        ) : remote ? (
          <p className="rounded-[14px] border border-white/[0.08] p-3 text-xs leading-relaxed text-zinc-400">
            This Pretty Suite runs on another machine, so it cannot open a browser for you. Paste your <span className="font-mono text-zinc-300">reddit_session</span> cookie from a browser where you are logged in to reddit.com.
          </p>
        ) : (
          <>
            <button className="btn btn-primary w-full py-2.5" disabled={busy} onClick={() => run('tab', () => api.post('/api/rd/login/tab', { remember }))}>
              <ExternalLink className="size-4" /> Log in with this browser
            </button>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Uses the Reddit login of the browser you have open, in a new tab if you still need to sign in. Needs "Allow remote debugging for this
              browser instance" ticked at <span className="font-mono text-zinc-300 select-all">chrome://inspect/#remote-debugging</span>.
            </p>
            <div className="my-4 flex items-center gap-3 text-[11px] text-zinc-600">
              <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
            </div>
            <button className="btn btn-ghost w-full py-2.5" disabled={busy} onClick={() => run('browser', () => api.post('/api/rd/login/browser', { remember }))}>
              <ExternalLink className="size-4" /> Log in in a separate window
            </button>
            <p className="mt-3 flex gap-2 text-xs leading-relaxed text-zinc-400">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
              Either way you log in on the real reddit.com page. Pretty Suite never sees your password — only the session, read from the browser once you're in.
            </p>
          </>
        )}

        <div className="mt-4">
          <Toggle checked={remember} onChange={setRemember} label="Stay connected on this device" hint="Keeps the session in your local app data folder so you do not log in each time. Never uploaded." />
        </div>
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>

        <button type="button" className="mt-4 flex cursor-pointer items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setManual(!manual)}>
          <KeyRound className="size-3.5" /> Advanced: paste a session cookie instead
          <ChevronDown className={cx('size-3.5 transition-transform', manual && 'rotate-180')} />
        </button>
        {manual && (
          <form className="mt-3" onSubmit={(e) => (e.preventDefault(), run('cookie', () => api.post('/api/rd/connect', { cookie, remember })))}>
            <p className="mb-2 text-xs leading-relaxed text-zinc-500">
              In a browser where you are logged in to reddit.com, press F12, open Application → Cookies → <span className="font-mono text-zinc-300">https://www.reddit.com</span>, and copy the value of{' '}
              <span className="font-mono text-zinc-300">reddit_session</span>.
            </p>
            <div className="relative">
              <input className="input pr-10 font-mono" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="Paste your reddit_session value" value={cookie} onChange={(e) => setCookie(e.target.value)} />
              <button type="button" className="absolute top-2.5 right-3 cursor-pointer text-zinc-500 hover:text-zinc-300" onClick={() => setShow(!show)}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <button className="btn btn-ghost mt-2 w-full" disabled={!cookie.trim() || busy}>
              {busy === 'cookie' && <Loader2 className="size-4 animate-spin" />} Connect with cookie
            </button>
          </form>
        )}

        <div className="mt-4 border-t border-white/8 pt-4">
          <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => run('demo', () => api.post('/api/rd/demo'))}>
            {busy === 'demo' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Explore with a demo account
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'purge', icon: Trash2, title: 'Delete comments and posts', text: 'Filter by community, date, score or text. Scan first, overwrite before deleting.' },
  { id: 'activity', icon: Bookmark, title: 'Clear saved items and votes', text: 'Unsave everything, withdraw upvotes and downvotes, unhide posts.' },
  { id: 'archive', icon: ArchiveIcon, title: 'Keep a local copy', text: 'Save your comments and posts to this computer, searchable and exportable.' },
];

export function RdOverview({ state, go }) {
  const { user, archive } = state.reddit;
  const years = (Date.now() - user.created) / (365.25 * 86400000);
  return (
    <>
      <PageHeader icon={LayoutDashboard} title={`u/${user.name}`} subtitle="Your Reddit account at a glance." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={MessageSquare} label="Comment karma" value={fmtNumber(user.commentKarma)} />
        <Stat icon={ArrowBigUp} label="Post karma" value={fmtNumber(user.postKarma)} />
        <Stat icon={Users} label="Account age" value={years >= 1 ? `${years.toFixed(1)} yr` : `${Math.max(1, Math.round(years * 12))} mo`} />
        <Stat icon={ArchiveIcon} label="In your archive" value={fmtNumber(archive.total)} hint={`${fmtNumber(archive.deleted)} since deleted`} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {ACTIONS.map((action) => (
          <button key={action.id} onClick={() => go(action.id)} className="card rise cursor-pointer p-5 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.06]">
            <action.icon className="size-5 text-accent-300" />
            <div className="mt-3 text-sm font-semibold">{action.title}</div>
            <div className="mt-1 text-xs text-zinc-500">{action.text}</div>
          </button>
        ))}
      </div>
    </>
  );
}

// ── Purge ─────────────────────────────────────────────────────────────────────────────────────────

export function RdPurge({ jobs }) {
  const [kinds, setKinds] = useState({ comments: true, posts: false });
  const [filters, setFilters] = useState({ only: '', except: '', after: '', before: '', keepScore: '', text: '', regex: '' });
  const [options, setOptions] = useState({ overwrite: true, overwriteText: '', safetyNet: true, pace: 2 });
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const job = latestJob(jobs, 'rd-purge');
  const busy = job?.status === 'running';
  const setF = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  const start = (dryRun) => {
    setError(null);
    startJob('rd-purge', { kinds, filters, ...options, dryRun, confirm }).then(() => setConfirm('')).catch((err) => setError(err.message));
  };

  return (
    <>
      <PageHeader icon={Trash2} title="Purge" subtitle="Delete your own comments and posts in bulk." tone="red" />
      <div className="grid gap-5 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="What to delete">
            <Toggle checked={kinds.comments} onChange={(v) => setKinds({ ...kinds, comments: v })} label="Comments" />
            <Toggle checked={kinds.posts} onChange={(v) => setKinds({ ...kinds, posts: v })} label="Posts" />
          </Card>

          <Card title="Narrow it down" hint="Leave everything blank to match all of them.">
            <label className="label">Only in these communities</label>
            <input className="input" placeholder="AskReddit, r/coffee" value={filters.only} onChange={setF('only')} />
            <label className="label mt-3">Never in these communities</label>
            <input className="input" placeholder="r/mycity" value={filters.except} onChange={setF('except')} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Written after</label>
                <input className="input" type="date" value={filters.after} onChange={setF('after')} />
              </div>
              <div>
                <label className="label">Written before</label>
                <input className="input" type="date" value={filters.before} onChange={setF('before')} />
              </div>
            </div>
            <label className="label mt-3">Keep anything scoring at least</label>
            <input className="input" type="number" placeholder="e.g. 100 — blank keeps nothing back" value={filters.keepScore} onChange={setF('keepScore')} />
            <label className="label mt-3">Containing the text</label>
            <input className="input" placeholder="a word or phrase" value={filters.text} onChange={setF('text')} />
            <label className="label mt-3">Matching the pattern (regex)</label>
            <input className="input font-mono" placeholder="\\b\\d{3}-\\d{4}\\b" value={filters.regex} onChange={setF('regex')} />
          </Card>

          <Card title="How">
            <Toggle checked={options.overwrite} onChange={(v) => setOptions({ ...options, overwrite: v })} label="Overwrite before deleting" hint="Replaces the text first, so copies taken by archive sites after this point hold the replacement rather than your words." />
            {options.overwrite && <input className="input mt-1 mb-2" placeholder="Replacement text (blank: random filler words)" value={options.overwriteText} onChange={(e) => setOptions({ ...options, overwriteText: e.target.value })} />}
            <Toggle checked={options.safetyNet} onChange={(v) => setOptions({ ...options, safetyNet: v })} label="Keep a copy in my archive first" hint="Saved on this computer only, before anything is changed." />
            <label className="label mt-3 flex justify-between">
              <span>Gap between deletions</span>
              <span className="text-zinc-300">about {options.pace}s, varied randomly</span>
            </label>
            <input type="range" min="1" max="15" step="1" value={options.pace} onChange={(e) => setOptions({ ...options, pace: Number(e.target.value) })} className="w-full accent-accent-500" />
          </Card>

          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-ghost w-full py-2.5" disabled={busy} onClick={() => start(true)}>
            <ScanSearch className="size-4" /> Scan: count what matches
          </button>
          <div className="card border-red-500/25 p-4">
            <p className="text-xs leading-relaxed text-zinc-400">Deleting cannot be undone. Type <span className="font-mono text-red-300">DELETE</span> to arm the button.</p>
            <input className="input mt-2 font-mono" placeholder="DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn btn-danger mt-2 w-full py-2.5" disabled={busy || confirm !== 'DELETE'} onClick={() => start(false)}>
              <Trash2 className="size-4" /> Delete matching items
            </button>
          </div>
        </div>
        <div className="space-y-5">
          {job ? <JobPanel job={job} tone="red" /> : <div className="card"><Empty icon={ScanSearch} title="Nothing run yet">Scan first to see how many comments and posts match before deleting anything.</Empty></div>}
          <p className="flex gap-2 rounded-xl border border-white/8 px-3 py-2.5 text-xs leading-relaxed text-zinc-500">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
            Reddit only lists about your newest 1,000 comments and 1,000 posts at a time. Pretty Suite keeps going back for more once those are gone, but items you chose to keep can hide older ones behind them.
          </p>
        </div>
      </div>
    </>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────────────────────────

export function RdActivity({ jobs }) {
  const [pick, setPick] = useState({ saved: true, upvoted: false, downvoted: false, hidden: false });
  const [error, setError] = useState(null);
  const job = latestJob(jobs, 'rd-activity');
  const busy = job?.status === 'running';
  const rows = [
    ['saved', 'Saved posts and comments', 'Unsave everything in your saved list.'],
    ['upvoted', 'Upvotes', 'Withdraw your upvotes. Reddit locks votes on posts older than six months, so those stay.'],
    ['downvoted', 'Downvotes', 'Withdraw your downvotes.'],
    ['hidden', 'Hidden posts', 'Unhide every post you have hidden.'],
  ];
  return (
    <>
      <PageHeader icon={Bookmark} title="Activity" subtitle="Clear the traces besides what you wrote: saved items, votes and hidden posts." />
      <div className="grid gap-5 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="What to clear">
            {rows.map(([key, label, hint]) => (
              <Toggle key={key} checked={pick[key]} onChange={(v) => setPick({ ...pick, [key]: v })} label={label} hint={hint} />
            ))}
          </Card>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full py-2.5" disabled={busy || !Object.values(pick).some(Boolean)} onClick={() => (setError(null), startJob('rd-activity', pick).catch((err) => setError(err.message)))}>
            <Bookmark className="size-4" /> Clear selected
          </button>
        </div>
        <div>{job ? <JobPanel job={job} /> : <div className="card"><Empty icon={Bookmark} title="Nothing run yet">Choose what to clear. Your own comments and posts are not touched here.</Empty></div>}</div>
      </div>
    </>
  );
}

// ── Communities ───────────────────────────────────────────────────────────────────────────────────

export function RdCommunities({ jobs }) {
  const { data, error, loading } = useFetch('/api/rd/communities', [finished(jobs)]);
  const [filter, setFilter] = useState('');
  const [failed, setFailed] = useState(null);
  const pick = useSelection();
  const job = latestJob(jobs, 'rd-leave');
  const busy = job?.status === 'running';
  const rows = (data || []).filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));
  const all = rows.length > 0 && rows.every((c) => pick.has(c.name));
  useEffect(() => pick.clear(), [finished(jobs)]);

  const leave = () =>
    startJob('rd-leave', { names: pick.ids, titles: Object.fromEntries((data || []).filter((c) => pick.has(c.name)).map((c) => [c.name, c.title])) }).catch((err) => setFailed(err.message));

  return (
    <>
      <PageHeader icon={Users} title="Communities" subtitle={data ? `You are in ${fmtNumber(data.length)} communities.` : 'The communities you have joined.'} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card
          title="Joined"
          action={<input className="input w-52" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        >
          <ErrorNote>{error || failed}</ErrorNote>
          {loading ? (
            <div className="grid place-items-center py-14 text-zinc-500"><Loader2 className="size-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <Empty icon={Users} title="No communities here" />
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2.5 px-2.5">
                <Box state={all} onClick={() => (all ? pick.clear() : pick.set(rows.map((c) => c.name)))} />
                <span className="text-xs text-zinc-500">{pick.ids.length ? `${pick.ids.length} selected` : 'Select all'}</span>
                <button className="btn btn-danger ml-auto px-3 py-1.5 text-xs" disabled={!pick.ids.length || busy} onClick={leave}>
                  <LogOut className="size-3.5" /> Leave {pick.ids.length || ''}
                </button>
              </div>
              <div className="max-h-[36rem] overflow-y-auto">
                {rows.map((c) => (
                  <div key={c.name} className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]" onClick={() => pick.toggle(c.name)}>
                    <Box state={pick.has(c.name)} onClick={() => {}} />
                    <Avatar size={30} name={c.title} src={c.icon} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.isUser ? `u/${c.title.slice(2)}` : `r/${c.title}`}</div>
                      <div className="truncate text-xs text-zinc-500">{c.about}</div>
                    </div>
                    <span className="text-xs text-zinc-600">{fmtNumber(c.members)} members</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
        <div>{job && <JobPanel job={job} />}</div>
      </div>
    </>
  );
}

// ── Archive ───────────────────────────────────────────────────────────────────────────────────────

export function RdArchive({ jobs }) {
  const [query, setQuery] = useState({ q: '', kind: '', deleted: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const done = finished(jobs);
  const { data: summary } = useFetch('/api/rd/archive/summary', [done]);
  const { data } = useFetch(`/api/rd/archive?${qs({ ...query, limit: 200 })}`, [done]);
  const job = latestJob(jobs, 'rd-archive');
  const busy = job?.status === 'running';

  return (
    <>
      <PageHeader icon={ArchiveIcon} title="Archive" subtitle="A local copy of what you wrote, kept on this computer only.">
        <a className="btn btn-ghost" href={`/api/rd/archive/export?${qs({ ...query, format: 'csv' })}`}><Download className="size-4" /> CSV</a>
        <a className="btn btn-ghost" href={`/api/rd/archive/export?${qs({ ...query, format: 'json' })}`}><Download className="size-4" /> JSON</a>
        <button className="btn btn-primary" disabled={busy} onClick={() => (setError(null), startJob('rd-archive', { saved }).catch((err) => setError(err.message)))}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {summary?.total ? 'Update archive' : 'Save my history'}
        </button>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Saved here" value={fmtNumber(summary?.total)} />
        <Stat label="Comments" value={fmtNumber(summary?.comments)} />
        <Stat label="Posts" value={fmtNumber(summary?.posts)} />
        <Stat label="Since deleted" value={fmtNumber(summary?.deleted)} hint="still kept here" />
      </div>
      <div className="mt-4">
        <Toggle checked={saved} onChange={setSaved} label="Also copy the things I saved" hint="Other people's posts and comments from your saved list." />
      </div>
      {busy || (job && job.status !== 'done') ? <div className="mt-5"><JobPanel job={job} /></div> : null}

      <Card
        className="mt-6"
        title={data ? `${fmtNumber(data.total)} item${data.total === 1 ? '' : 's'}` : 'Items'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-56" placeholder="Search text" value={query.q} onChange={(e) => setQuery({ ...query, q: e.target.value })} />
            <Segmented value={query.kind} onChange={(kind) => setQuery({ ...query, kind })} options={[{ value: '', label: 'All' }, { value: 'comment', label: 'Comments' }, { value: 'post', label: 'Posts' }]} />
            <Segmented value={query.deleted} onChange={(deleted) => setQuery({ ...query, deleted })} options={[{ value: '', label: 'Everything' }, { value: '1', label: 'Deleted' }]} />
          </div>
        }
      >
        {!data?.items.length ? (
          <Empty icon={ArchiveIcon} title="Nothing here yet">Press “Save my history” to copy your comments and posts, or turn on the safety net when purging.</Empty>
        ) : (
          <div className="max-h-[40rem] divide-y divide-white/6 overflow-y-auto">
            {data.items.map((item) => (
              <div key={item.name} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span className="font-medium text-accent-200">r/{item.subreddit}</span>
                  <span>{item.kind}</span>
                  <span>{fmtNumber(item.score)} points</span>
                  <span>{fmtTime(item.ts)}</span>
                  {item.deleted_ts && <span className="text-red-300">deleted {fmtTime(item.deleted_ts)}</span>}
                  {item.permalink && !item.deleted_ts && <a className="hover:underline" href={item.permalink} target="_blank" rel="noreferrer">open</a>}
                </div>
                {item.title && <div className="mt-0.5 text-sm font-medium text-zinc-200">{item.title}</div>}
                {item.body && <div className="mt-0.5 text-sm break-words whitespace-pre-wrap text-zinc-400">{item.body.length > 600 ? `${item.body.slice(0, 600)}…` : item.body}</div>}
                {item.url && <div className="mt-0.5 truncate text-xs text-zinc-500">{item.url}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────

export function RdSettings({ state, refresh }) {
  const [error, setError] = useState(null);
  const { user, demo } = state.reddit;
  return (
    <>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Your Reddit connection." />
      <div className="max-w-2xl space-y-5">
        <ErrorNote>{error}</ErrorNote>
        <Card title="Reddit account">
          <div className="flex items-center gap-3">
            <Avatar size={44} name={user.name} src={user.icon} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">u/{user.name}</div>
              <div className="text-xs text-zinc-500">{demo ? 'Demo account' : `${fmtNumber(user.commentKarma + user.postKarma)} karma`}</div>
            </div>
            <button className="btn btn-ghost" onClick={() => api.post('/api/rd/disconnect').then(refresh).catch((err) => setError(err.message))}>
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
        </Card>
        <Card title="How Pretty Suite treats your account">
          <ul className="space-y-2 text-xs leading-relaxed text-zinc-400">
            <li>It only removes or changes things that are yours: your comments, posts, saved items, votes and memberships.</li>
            <li>Every action is spaced out, and it slows down further whenever Reddit says its allowance is running low.</li>
            <li>Jobs save their place as they go, so closing the app mid-job loses nothing: it carries on when reopened.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
