import { HeartHandshake, LayoutDashboard, Loader2, RefreshCw, TrendingDown, TrendingUp, UserMinus, UserPlus, Users } from 'lucide-react';
import { fmtNumber, fmtTime, useFetch } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { Avatar, Card, Empty, PageHeader, Stat, cx } from '../ui.jsx';
import { finishedCount, igImg, latestJob, startIgJob } from './shared.jsx';

const ACTIONS = [
  { id: 'grow', icon: TrendingUp, title: 'Find people to follow', text: 'By keyword, hashtag or similar accounts, ranked by follow-back odds.' },
  { id: 'followback', icon: HeartHandshake, title: 'Follow back your followers', text: 'Skip bots, ghosts and follow-unfollow players automatically.' },
  { id: 'audience', icon: UserMinus, title: 'Clean up who you follow', text: 'See who does not follow back and who recently left.' },
];

export default function IgOverview({ state, jobs, go }) {
  const ig = state.instagram;
  const sync = latestJob(jobs, 'ig-sync');
  const syncing = sync?.status === 'running';
  const { data: events } = useFetch('/api/ig/events?kinds=gained,lost', [finishedCount(jobs)]);
  const c = ig.counts;

  return (
    <>
      <PageHeader icon={LayoutDashboard} title={`@${ig.user.username}`} subtitle={ig.synced ? `Audience last synced ${fmtTime(ig.synced)}` : 'Sync your audience to unlock the numbers below.'}>
        <button className="btn btn-primary" disabled={syncing} onClick={() => startIgJob('ig-sync', {})}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {ig.synced ? 'Sync again' : 'Sync audience'}
        </button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat icon={Users} label="Followers" value={fmtNumber(ig.synced ? c.followers : ig.user.followers)} />
        <Stat icon={UserPlus} label="Following" value={fmtNumber(ig.synced ? c.following : ig.user.following)} />
        <Stat icon={HeartHandshake} label="Mutuals" value={ig.synced ? fmtNumber(c.mutual) : '–'} hint="you follow each other" />
        <Stat icon={UserMinus} label="Don't follow back" value={ig.synced ? fmtNumber(c.nonfollowers) : '–'} hint="you follow them" />
        <Stat icon={TrendingUp} label="Fans" value={ig.synced ? fmtNumber(c.fans) : '–'} hint="they follow you" />
      </div>

      {syncing || (sync && sync.status !== 'done') ? (
        <div className="mt-6">
          <JobPanel job={sync} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {ACTIONS.map((action) => (
          <button key={action.id} onClick={() => go(action.id)} className="card rise cursor-pointer p-5 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.06]">
            <action.icon className="size-5 text-accent-300" />
            <div className="mt-3 text-sm font-semibold">{action.title}</div>
            <div className="mt-1 text-xs text-zinc-500">{action.text}</div>
          </button>
        ))}
      </div>

      <Card title="Follower changes" hint="Compared between syncs — sync regularly to catch who leaves." className="mt-6">
        {!events?.length ? (
          <Empty icon={TrendingDown} title="No changes recorded yet">The first sync sets a baseline. Each sync after that shows who followed and who left.</Empty>
        ) : (
          <div className="max-h-80 divide-y divide-white/6 overflow-y-auto">
            {events.map((event, i) => (
              <div key={i} className="flex items-center gap-3 py-2 text-sm">
                <Avatar size={28} name={event.username || '?'} src={igImg(event.pic)} />
                <span className="flex-1 truncate">@{event.username || event.pk}</span>
                <span className={cx('text-xs font-medium', event.kind === 'gained' ? 'text-emerald-300' : 'text-red-300')}>
                  {event.kind === 'gained' ? 'started following you' : 'unfollowed you'}
                </span>
                <span className="w-32 text-right text-xs text-zinc-600">{fmtTime(event.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
