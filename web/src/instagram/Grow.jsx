import { useState } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import JobPanel from '../components/JobPanel.jsx';
import { Card, ErrorNote, PageHeader, Toggle } from '../ui.jsx';
import { CandidateList, DEFAULT_RULES, PaceCard, RulesCard, finishedCount, latestJob, startIgJob } from './shared.jsx';

const split = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

export default function Grow({ jobs }) {
  const [sources, setSources] = useState({ keywords: '', hashtags: '', similarTo: '', includeFollowers: true, limit: 40 });
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [pace, setPace] = useState({ dailyCap: 40, pace: 30 });
  const [autoFollow, setAutoFollow] = useState(false);
  const [error, setError] = useState(null);

  const job = latestJob(jobs, 'ig-discover', 'ig-follow');
  const busy = job?.status === 'running';
  const set = (key, value) => setSources((s) => ({ ...s, [key]: value }));
  const ready = sources.keywords.trim() || sources.hashtags.trim() || sources.similarTo.trim();

  const find = () => {
    setError(null);
    startIgJob('ig-discover', {
      keywords: split(sources.keywords),
      hashtags: split(sources.hashtags),
      similarTo: split(sources.similarTo),
      includeFollowers: sources.includeFollowers,
      limit: sources.limit,
      rules,
      autoFollow,
      ...pace,
    }).catch((err) => setError(err.message));
  };

  return (
    <>
      <PageHeader icon={TrendingUp} title="Grow" subtitle="Find relevant people, ranked by how likely they are to follow you back." />

      <div className="grid gap-5 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="Where to look" hint="Use any mix. Separate entries with commas.">
            <label className="label">Keywords</label>
            <input className="input" placeholder="specialty coffee, latte art" value={sources.keywords} onChange={(e) => set('keywords', e.target.value)} />
            <p className="mt-1 text-[11px] text-zinc-600">Accounts whose name or bio matches.</p>

            <label className="label mt-3">Hashtags</label>
            <input className="input" placeholder="#filmphotography, #35mm" value={sources.hashtags} onChange={(e) => set('hashtags', e.target.value)} />
            <p className="mt-1 text-[11px] text-zinc-600">People currently posting under them.</p>

            <label className="label mt-3">Similar to these accounts</label>
            <input className="input" placeholder="@someaccount, @another" value={sources.similarTo} onChange={(e) => set('similarTo', e.target.value)} />
            <p className="mt-1 text-[11px] text-zinc-600">Accounts Instagram considers similar to them.</p>
            <Toggle
              checked={sources.includeFollowers}
              onChange={(v) => set('includeFollowers', v)}
              label="Also include their followers"
              hint="People already interested in that kind of account."
            />

            <label className="label mt-3 flex justify-between">
              <span>Profiles to check</span>
              <span className="text-zinc-300">up to {sources.limit}</span>
            </label>
            <input type="range" min="10" max="300" step="10" value={sources.limit} onChange={(e) => set('limit', Number(e.target.value))} className="w-full accent-accent-500" />
            <p className="mt-1 text-[11px] text-zinc-600">Each profile is opened once to score it — roughly 3 seconds apiece.</p>
          </Card>

          <RulesCard rules={rules} onChange={setRules} withScore />
          <PaceCard pace={pace} onChange={setPace} refreshKey={finishedCount(jobs)} />

          <Card>
            <Toggle
              checked={autoFollow}
              onChange={setAutoFollow}
              label="Autopilot"
              hint="Follow the best matches straight away, up to today's limit. Off: you review the list first."
            />
          </Card>

          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full py-2.5" disabled={!ready || busy} onClick={find}>
            <Search className="size-4" /> {autoFollow ? 'Find and follow' : 'Find people'}
          </button>
        </div>

        <div className="space-y-5">
          <JobPanel job={job} />
          <CandidateList
            list="grow"
            refreshKey={finishedCount(jobs)}
            pace={pace}
            busy={busy}
            emptyText="Tell Pretty Suite where to look, then press Find people. Matches appear here with a follow-back score."
          />
        </div>
      </div>
    </>
  );
}
