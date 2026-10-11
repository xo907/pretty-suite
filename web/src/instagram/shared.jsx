import { useEffect, useState } from 'react';
import { BadgeCheck, Lock, Star, UserPlus, X } from 'lucide-react';
import { api, fmtNumber, useFetch } from '../api.js';
import { Box } from '../components/TargetPicker.jsx';
import { Avatar, Card, Empty, ErrorNote, Segmented, Toggle, cx } from '../ui.jsx';

/** Instagram's image CDN can't be embedded directly, so pictures go through the local server. */
export const igImg = (url) => (url ? `/api/ig/img?u=${encodeURIComponent(url)}` : null);

export const startIgJob = (type, config) => api.post('/api/ig/jobs', { type, config });
export const latestJob = (jobs, ...types) => jobs.find((j) => types.includes(j.type));
export const finishedCount = (jobs) => jobs.filter((j) => j.status !== 'running' && j.type.startsWith('ig-')).length;

const compact = (n) => (n === null || n === undefined ? '–' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n));

export function useSelection() {
  const [selected, setSelected] = useState({});
  return {
    selected,
    ids: Object.keys(selected),
    has: (id) => Boolean(selected[id]),
    toggle: (id) =>
      setSelected((s) => {
        const next = { ...s };
        next[id] ? delete next[id] : (next[id] = true);
        return next;
      }),
    set: (ids) => setSelected(Object.fromEntries(ids.map((id) => [id, true]))),
    clear: () => setSelected({}),
  };
}

export function ScorePill({ score }) {
  const tone = score >= 70 ? 'bg-emerald-400/15 text-emerald-300' : score >= 45 ? 'bg-amber-400/15 text-amber-300' : 'bg-red-400/15 text-red-300';
  return (
    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', tone)} title="Estimated chance they follow back">
      {score}%
    </span>
  );
}

const REASON_TONE = { good: 'text-emerald-300/90', bad: 'text-zinc-500', block: 'text-red-300' };

export function PersonRow({ user, selected, onToggle, children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]">
      {onToggle && (
        <div className="pt-2">
          <Box state={selected} onClick={onToggle} />
        </div>
      )}
      <Avatar size={36} name={user.username || '?'} src={igImg(user.pic)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5">
          <a href={`https://www.instagram.com/${user.username}/`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-zinc-100 hover:underline">
            @{user.username}
          </a>
          {Boolean(user.isVerified) && <BadgeCheck className="size-3.5 text-sky-400" />}
          {Boolean(user.isPrivate) && <Lock className="size-3 text-zinc-500" />}
          {user.source && <span className="text-[11px] text-zinc-600">· {user.source}</span>}
        </div>
        <div className="text-xs text-zinc-500">
          {user.followers !== null && user.followers !== undefined
            ? `${compact(user.followers)} followers · ${compact(user.following)} following · ${compact(user.posts)} posts`
            : user.fullName}
        </div>
        {user.reasons?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">
            {user.reasons.map((reason) => (
              <span key={reason.text} className={REASON_TONE[reason.tone]}>
                {reason.tone === 'block' ? '✕ ' : reason.tone === 'good' ? '+ ' : '− '}
                {reason.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">{children}</div>
    </div>
  );
}

/** The exclusion rules shared by Grow and Follow Back. */
export function RulesCard({ rules, onChange, withScore }) {
  const set = (patch) => onChange({ ...rules, ...patch });
  return (
    <Card title="Who to leave out" hint="Anyone matching a rule is set aside, with the reason shown.">
      <Toggle checked={rules.noPic} onChange={(v) => set({ noPic: v })} label="No profile picture" hint="Usually throwaway or bot accounts." />
      <Toggle
        checked={rules.inactive}
        onChange={(v) => set({ inactive: v })}
        label="Inactive accounts"
        hint={`Never posted, or nothing in the last ${rules.inactiveDays} days.`}
      />
      {rules.inactive && (
        <input type="range" min="30" max="365" step="15" value={rules.inactiveDays} onChange={(e) => set({ inactiveDays: Number(e.target.value) })} className="mb-1 ml-12 w-56 accent-accent-500" />
      )}
      <Toggle
        checked={rules.highRatio}
        onChange={(v) => set({ highRatio: v })}
        label="Likely to unfollow"
        hint={`Followed by at least ${rules.ratio}× more people than they follow — the pattern of follow-then-unfollow accounts.`}
      />
      {rules.highRatio && (
        <input type="range" min="2" max="20" step="1" value={rules.ratio} onChange={(e) => set({ ratio: Number(e.target.value) })} className="mb-1 ml-12 w-56 accent-accent-500" />
      )}
      <Toggle checked={rules.private} onChange={(v) => set({ private: v })} label="Private accounts" />
      <Toggle checked={rules.verified} onChange={(v) => set({ verified: v })} label="Verified accounts" />
      {withScore && (
        <div className="mt-3">
          <label className="label flex justify-between">
            <span>Minimum follow-back score</span>
            <span className="text-zinc-300">{rules.minScore}%</span>
          </label>
          <input type="range" min="0" max="90" step="5" value={rules.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} className="w-full accent-accent-500" />
          <p className="mt-1 text-[11px] text-zinc-600">
            An estimate from each profile: how many people they follow versus follow them, account size, and how recently they posted.
          </p>
        </div>
      )}
    </Card>
  );
}

export const DEFAULT_RULES = { noPic: true, inactive: true, inactiveDays: 90, highRatio: true, ratio: 5, private: false, verified: false, minScore: 50 };

/** Daily limit and pacing, with today's usage. */
export function PaceCard({ pace, onChange, kind = 'follow', refreshKey }) {
  const { data } = useFetch('/api/ig/limits', [refreshKey]);
  const used = data?.[kind === 'follow' ? 'followed' : 'unfollowed'] ?? 0;
  const risky = pace.dailyCap > 80 || pace.pace < 15;
  return (
    <Card title="Pace" hint="Instagram restricts accounts that act too fast. Slower is safer.">
      <label className="label flex justify-between">
        <span>Daily limit</span>
        <span className="text-zinc-300">
          {pace.dailyCap} {kind}s · {used} used in the last 24h
        </span>
      </label>
      <input type="range" min="5" max="200" step="5" value={pace.dailyCap} onChange={(e) => onChange({ ...pace, dailyCap: Number(e.target.value) })} className="w-full accent-accent-500" />
      <label className="label mt-3 flex justify-between">
        <span>Gap between actions</span>
        <span className="text-zinc-300">about {pace.pace}s, varied randomly</span>
      </label>
      <input type="range" min="5" max="120" step="5" value={pace.pace} onChange={(e) => onChange({ ...pace, pace: Number(e.target.value) })} className="w-full accent-accent-500" />
      {risky && (
        <p className="mt-2 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11.5px] text-amber-200">
          These settings are aggressive. Expect Instagram to temporarily block follows, or flag the account, if you keep this up.
        </p>
      )}
    </Card>
  );
}

/** People found by a scan, split into good matches and ruled-out, with follow / skip actions. */
export function CandidateList({ list, refreshKey, pace, emptyText, busy }) {
  const { data, reload } = useFetch(`/api/ig/queue?list=${list}`, [refreshKey]);
  const [tab, setTab] = useState('ok');
  const [error, setError] = useState(null);
  const pick = useSelection();
  const rows = (data || []).filter((row) => row.verdict === tab);
  const counts = { ok: (data || []).filter((r) => r.verdict === 'ok').length, excluded: (data || []).filter((r) => r.verdict === 'excluded').length };
  useEffect(() => pick.clear(), [tab, refreshKey]);

  const follow = (pks) => startIgJob('ig-follow', { pks, ...pace }).then(pick.clear).catch((err) => setError(err.message));
  const skip = (pks) => api.post('/api/ig/queue/skip', { pks }).then(() => (pick.clear(), reload()));
  const allSelected = rows.length > 0 && rows.every((r) => pick.has(r.pk));

  return (
    <Card
      title="Results"
      action={
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ok', label: `Good matches · ${counts.ok}` },
            { value: 'excluded', label: `Ruled out · ${counts.excluded}` },
          ]}
        />
      }
    >
      <ErrorNote>{error}</ErrorNote>
      {rows.length === 0 ? (
        <Empty icon={UserPlus} title={tab === 'ok' ? 'No one here yet' : 'Nobody ruled out'}>{tab === 'ok' ? emptyText : 'Accounts your rules set aside appear here, each with the reason.'}</Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2.5 px-2.5">
            <Box state={allSelected} onClick={() => (allSelected ? pick.clear() : pick.set(rows.map((r) => r.pk)))} />
            <span className="text-xs text-zinc-500">{pick.ids.length ? `${pick.ids.length} selected` : 'Select all'}</span>
            <div className="ml-auto flex gap-2">
              <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={!pick.ids.length} onClick={() => skip(pick.ids)}>
                <X className="size-3.5" /> Dismiss
              </button>
              <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={!pick.ids.length || busy} onClick={() => follow(pick.ids)}>
                <UserPlus className="size-3.5" /> Follow {pick.ids.length || ''}
              </button>
            </div>
          </div>
          <div className="max-h-[34rem] overflow-y-auto">
            {rows.map((row) => (
              <PersonRow key={row.pk} user={row} selected={pick.has(row.pk)} onToggle={() => pick.toggle(row.pk)}>
                <ScorePill score={row.score} />
              </PersonRow>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function KeepStar({ user, onChange }) {
  return (
    <button
      title={user.kept ? 'On your never-unfollow list' : 'Add to your never-unfollow list'}
      className={cx('cursor-pointer transition', user.kept ? 'text-amber-300' : 'text-zinc-600 hover:text-zinc-300')}
      onClick={() => api.post('/api/ig/whitelist', { pk: user.pk, on: !user.kept }).then(onChange)}
    >
      <Star className="size-4" fill={user.kept ? 'currentColor' : 'none'} />
    </button>
  );
}

export { fmtNumber };
