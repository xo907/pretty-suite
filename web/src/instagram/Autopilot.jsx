import { useEffect, useState } from 'react';
import { Bot, Heart, Moon, Play, TriangleAlert, UserMinus, UserPlus } from 'lucide-react';
import JobPanel from '../components/JobPanel.jsx';
import { useFetch } from '../api.js';
import { Card, ErrorNote, PageHeader, Toggle } from '../ui.jsx';
import { RulesCard, latestJob, startIgJob } from './shared.jsx';

const list = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
const hour = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

function Slider({ label, value, suffix, onChange, ...range }) {
  return (
    <>
      <label className="label mt-3 flex justify-between">
        <span>{label}</span>
        <span className="text-zinc-300">{suffix}</span>
      </label>
      <input type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-accent-500" {...range} />
    </>
  );
}

export default function Autopilot({ jobs }) {
  const { data: saved } = useFetch('/api/ig/autopilot');
  const { data: limits } = useFetch('/api/ig/limits', [jobs.length]);
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    // Sources are edited as comma-separated text.
    if (saved && !cfg) setCfg({ ...saved, follow: { ...saved.follow, keywords: saved.follow.keywords.join(', '), hashtags: saved.follow.hashtags.join(', '), similarTo: saved.follow.similarTo.join(', ') } });
  }, [saved]);

  const job = latestJob(jobs, 'ig-autopilot');
  const running = job?.status === 'running' || job?.status === 'interrupted';
  if (!cfg) return <PageHeader icon={Bot} title="Autopilot" subtitle="Looks after your account around the clock." />;

  const set = (section, patch) => setCfg((c) => ({ ...c, [section]: { ...c[section], ...patch } }));
  const { follow, unfollow, like, quiet } = cfg;
  const heavy = (follow.on && follow.perDay > 60) || (unfollow.on && unfollow.perDay > 60) || (like.on && like.perDay > 120);

  const start = () => {
    setError(null);
    startIgJob('ig-autopilot', { ...cfg, follow: { ...follow, keywords: list(follow.keywords), hashtags: list(follow.hashtags), similarTo: list(follow.similarTo) } }).catch((err) => setError(err.message));
  };

  return (
    <>
      <PageHeader icon={Bot} title="Autopilot" subtitle="Follows, unfollows and likes for you in short bursts at irregular times, day and night, until you stop it." />

      <div className="grid gap-5 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <fieldset disabled={running} className={running ? 'space-y-5 opacity-60' : 'space-y-5'}>
          <Card title={<span className="flex items-center gap-2"><UserPlus className="size-4 text-accent-300" /> Follow new people</span>}>
            <Toggle checked={follow.on} onChange={(on) => set('follow', { on })} label="Follow good matches" hint="Finds people in the places below, scores each profile, and follows the ones likely to follow back." />
            {follow.on && (
              <>
                <Slider label="Up to per day" value={follow.perDay} suffix={`${follow.perDay} follows`} min="5" max="150" step="5" onChange={(perDay) => set('follow', { perDay })} />
                <label className="label mt-3">Keywords</label>
                <input className="input" placeholder="specialty coffee, latte art" value={follow.keywords} onChange={(e) => set('follow', { keywords: e.target.value })} />
                <label className="label mt-3">Hashtags</label>
                <input className="input" placeholder="#filmphotography, #35mm" value={follow.hashtags} onChange={(e) => set('follow', { hashtags: e.target.value })} />
                <label className="label mt-3">Followers of these accounts</label>
                <input className="input" placeholder="@someaccount, @another" value={follow.similarTo} onChange={(e) => set('follow', { similarTo: e.target.value })} />
                <p className="mt-1 text-[11px] text-zinc-600">Separate entries with commas. People you unfollowed before are never followed again.</p>
              </>
            )}
          </Card>
          {follow.on && <RulesCard rules={follow.rules} onChange={(rules) => set('follow', { rules })} withScore />}

          <Card title={<span className="flex items-center gap-2"><UserMinus className="size-4 text-accent-300" /> Unfollow</span>}>
            <Toggle checked={unfollow.on} onChange={(on) => set('unfollow', { on })} label="Unfollow people who don't follow back" hint="Anyone followed through Pretty Suite who has not followed you back in time. Starred accounts are never touched." />
            {unfollow.on && (
              <>
                <Slider label="Give them" value={unfollow.afterDays} suffix={`${unfollow.afterDays} day${unfollow.afterDays > 1 ? 's' : ''} to follow back`} min="1" max="30" step="1" onChange={(afterDays) => set('unfollow', { afterDays })} />
                <Slider label="Up to per day" value={unfollow.perDay} suffix={`${unfollow.perDay} unfollows`} min="5" max="150" step="5" onChange={(perDay) => set('unfollow', { perDay })} />
                <div className="mt-2">
                  <Toggle checked={unfollow.everyone} onChange={(everyone) => set('unfollow', { everyone })} label="Also everyone else who doesn't follow you" hint="Includes accounts you followed yourself, such as brands and celebrities. Star the ones to keep on the Audience page first." />
                </div>
              </>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-2"><Heart className="size-4 text-accent-300" /> Like posts</span>}>
            <Toggle checked={like.on} onChange={(on) => set('like', { on })} label="Like recent posts" hint="One recent post at a time, from a randomly chosen account." />
            {like.on && (
              <>
                <Slider label="Up to per day" value={like.perDay} suffix={`${like.perDay} likes`} min="5" max="300" step="5" onChange={(perDay) => set('like', { perDay })} />
                <div className="mt-2">
                  <Toggle checked={like.newFollows} onChange={(newFollows) => set('like', { newFollows })} label="Accounts Autopilot just followed" hint="A like soon after the follow makes a follow-back more likely." />
                  <Toggle checked={like.followers} onChange={(followers) => set('like', { followers })} label="People who follow you" />
                  <Toggle checked={like.following} onChange={(following) => set('like', { following })} label="People you follow" />
                </div>
              </>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-2"><Moon className="size-4 text-accent-300" /> Quiet hours</span>}>
            <Toggle checked={quiet.on} onChange={(on) => set('quiet', { on })} label="Do nothing during set hours" hint="Off: Autopilot is active at any hour. On is closer to how a person uses the app." />
            {quiet.on && (
              <div className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                From
                <select className="input w-28" value={quiet.from} onChange={(e) => set('quiet', { from: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}
                </select>
                to
                <select className="input w-28" value={quiet.to} onChange={(e) => set('quiet', { to: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}
                </select>
              </div>
            )}
          </Card>
        </fieldset>

        <div className="space-y-5">
          {heavy && !running && (
            <p className="flex gap-2 rounded-xl bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              These daily numbers are high. Random timing does not hide volume: Instagram restricts accounts on how much they do, so expect blocks at this level.
            </p>
          )}
          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full py-2.5" disabled={running} onClick={start}>
            <Play className="size-4" /> {running ? 'Autopilot is running — stop it to change settings' : 'Start Autopilot'}
          </button>
          <JobPanel job={job} />
          <Card title="How it behaves">
            <ul className="space-y-2 text-xs leading-relaxed text-zinc-400">
              <li>Each day gets its own plan: a random 70–100% of your daily numbers, done in sessions of a few actions with breaks of minutes to hours between them.</li>
              <li>Your follower lists are re-read a few times a day, which is how it knows who followed back.</li>
              <li>It survives restarts: close Pretty Suite and it continues the same day's plan when the app is next opened. It only runs while Pretty Suite is running.</li>
              <li>If Instagram pushes back it does nothing for a day and halves that day's plan. A second time within a week, it stops.</li>
              {limits && <li className="text-zinc-500">Last 24 hours on this account: {limits.followed} followed, {limits.unfollowed} unfollowed, {limits.liked} liked.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
