import { useState } from 'react';
import { RefreshCw, Search, UserMinus, Users } from 'lucide-react';
import { useFetch } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { Box } from '../components/TargetPicker.jsx';
import { Card, Chip, Empty, ErrorNote, Modal, PageHeader, Segmented } from '../ui.jsx';
import { KeepStar, PaceCard, PersonRow, finishedCount, latestJob, startIgJob, useSelection } from './shared.jsx';

const DAY = 86400000;
const VIEWS = [
  { value: 'nonfollowers', label: "Don't follow back", hint: 'You follow them; they do not follow you.' },
  { value: 'mutual', label: 'Mutuals', hint: 'You follow each other.' },
  { value: 'fans', label: 'Fans', hint: 'They follow you; you do not follow them. Use Follow Back to act on these.' },
];

export default function Audience({ state, jobs }) {
  const [view, setView] = useState('nonfollowers');
  const [filter, setFilter] = useState('');
  const [stale, setStale] = useState(false);
  const [pace, setPace] = useState({ dailyCap: 60, pace: 25 });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const pick = useSelection();
  const refreshKey = finishedCount(jobs);
  const { data, reload } = useFetch(`/api/ig/people?view=${view}`, [refreshKey]);

  const job = latestJob(jobs, 'ig-unfollow', 'ig-sync');
  const busy = job?.status === 'running';
  const needle = filter.trim().toLowerCase();
  const rows = (data || []).filter(
    (u) => (!needle || u.username.toLowerCase().includes(needle)) && (!stale || (u.followedTs && Date.now() - u.followedTs > 5 * DAY))
  );
  const selectable = rows.filter((u) => !u.kept);
  const allSelected = selectable.length > 0 && selectable.every((u) => pick.has(u.pk));
  const canUnfollow = view !== 'fans';

  const unfollow = () => {
    setConfirm(false);
    setError(null);
    startIgJob('ig-unfollow', { pks: pick.ids, ...pace }).then(pick.clear).catch((err) => setError(err.message));
  };

  return (
    <>
      <PageHeader icon={Users} title="Audience" subtitle="Who follows you, who you follow, and where the two do not line up.">
        <button className="btn btn-ghost" disabled={busy} onClick={() => startIgJob('ig-sync', {})}>
          <RefreshCw className="size-4" /> Sync
        </button>
      </PageHeader>

      {!state.instagram.synced ? (
        <div className="card">
          <Empty icon={Users} title="Sync your audience first">
            Pretty Suite needs one pass over your followers and following to compare them. Press Sync above.
          </Empty>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card
            title={VIEWS.find((v) => v.value === view).hint}
            action={<Segmented value={view} onChange={(v) => (setView(v), pick.clear())} options={VIEWS.map((v) => ({ value: v.value, label: `${v.label} · ${state.instagram.counts[v.value] ?? 0}` }))} />}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              {canUnfollow && <Box state={allSelected} onClick={() => (allSelected ? pick.clear() : pick.set(selectable.map((u) => u.pk)))} />}
              <div className="relative min-w-44 flex-1">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
                <input className="input pl-9" placeholder="Filter by username" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              {view === 'nonfollowers' && (
                <Chip active={stale} onClick={() => setStale(!stale)}>
                  Followed via Pretty Suite 5+ days ago
                </Chip>
              )}
            </div>
            {rows.length === 0 ? (
              <Empty icon={Users} title="Nobody here" />
            ) : (
              <div className="max-h-[36rem] overflow-y-auto">
                {rows.map((user) => (
                  <PersonRow key={user.pk} user={user} selected={pick.has(user.pk)} onToggle={canUnfollow && !user.kept ? () => pick.toggle(user.pk) : undefined}>
                    {canUnfollow && <KeepStar user={user} onChange={reload} />}
                  </PersonRow>
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-5">
            {canUnfollow && (
              <>
                <PaceCard pace={pace} onChange={setPace} kind="unfollow" refreshKey={refreshKey} />
                <ErrorNote>{error}</ErrorNote>
                <button className="btn btn-danger w-full py-2.5" disabled={!pick.ids.length || busy} onClick={() => setConfirm(true)}>
                  <UserMinus className="size-4" /> Unfollow {pick.ids.length || ''} selected
                </button>
                <p className="text-center text-[11px] leading-relaxed text-zinc-600">
                  Star anyone you never want unfollowed — friends, brands, people you simply like. Starred accounts cannot be selected.
                </p>
              </>
            )}
            <JobPanel job={job} />
          </div>
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Unfollow ${pick.ids.length} account(s)?`}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={unfollow}>Unfollow</button>
          </>
        }
      >
        They are unfollowed one at a time at the pace you set, stopping at your daily limit. Private accounts would need to approve you again
        if you change your mind.
      </Modal>
    </>
  );
}
