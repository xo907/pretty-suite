import { useState } from 'react';
import { HeartHandshake, ScanSearch } from 'lucide-react';
import { fmtNumber } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { Card, ErrorNote, PageHeader, Toggle } from '../ui.jsx';
import { CandidateList, DEFAULT_RULES, PaceCard, RulesCard, finishedCount, latestJob, startIgJob } from './shared.jsx';

export default function FollowBack({ state, jobs }) {
  const [rules, setRules] = useState({ ...DEFAULT_RULES, minScore: 0 });
  const [pace, setPace] = useState({ dailyCap: 40, pace: 30 });
  const [limit, setLimit] = useState(100);
  const [resync, setResync] = useState(true);
  const [error, setError] = useState(null);

  const job = latestJob(jobs, 'ig-followback', 'ig-follow');
  const busy = job?.status === 'running';
  const fans = state.instagram.counts.fans;

  const review = () => {
    setError(null);
    startIgJob('ig-followback', { rules, limit, resync }).catch((err) => setError(err.message));
  };

  return (
    <>
      <PageHeader icon={HeartHandshake} title="Follow Back" subtitle="Return the follow to people who follow you — minus the accounts not worth it." />

      <div className="grid gap-5 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="Your followers" hint={state.instagram.synced ? `${fmtNumber(fans)} follow you that you do not follow back.` : 'Your audience has not been synced yet — the review does that first.'}>
            <label className="label flex justify-between">
              <span>Followers to review</span>
              <span className="text-zinc-300">up to {limit}</span>
            </label>
            <input type="range" min="20" max="1000" step="20" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full accent-accent-500" />
            <Toggle checked={resync} onChange={setResync} label="Refresh my follower list first" hint="Catches anyone who followed since the last sync." />
          </Card>

          <RulesCard rules={rules} onChange={setRules} />
          <PaceCard pace={pace} onChange={setPace} refreshKey={finishedCount(jobs)} />

          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full py-2.5" disabled={busy} onClick={review}>
            <ScanSearch className="size-4" /> Review my followers
          </button>
          <p className="text-center text-[11px] text-zinc-600">Nothing is followed until you choose who, in the results.</p>
        </div>

        <div className="space-y-5">
          <JobPanel job={job} />
          <CandidateList
            list="followback"
            refreshKey={finishedCount(jobs)}
            pace={pace}
            busy={busy}
            emptyText="Press Review my followers. Everyone who passes your rules lands here, ready to follow back."
          />
        </div>
      </div>
    </>
  );
}
