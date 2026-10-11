import { useEffect, useState } from 'react';
import {
  Archive as ArchiveIcon,
  BarChart3,
  Bomb,
  Bookmark,
  Bot,
  Database,
  HeartHandshake,
  Image as ImageIcon,
  LayoutDashboard,
  Loader2,
  MessagesSquare,
  Radio,
  Settings as SettingsIcon,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api, avatarUrl, useEvent, useJobs } from './api.js';
import { Avatar, cx } from './ui.jsx';
import Connect from './pages/Connect.jsx';
import Overview from './pages/Overview.jsx';
import Purge from './pages/Purge.jsx';
import Nuke from './pages/Nuke.jsx';
import Archive from './pages/Archive.jsx';
import Vault from './pages/Vault.jsx';
import Logger from './pages/Logger.jsx';
import Insights from './pages/Insights.jsx';
import Settings from './pages/Settings.jsx';
import IgConnect from './instagram/IgConnect.jsx';
import IgOverview from './instagram/IgOverview.jsx';
import Autopilot from './instagram/Autopilot.jsx';
import Grow from './instagram/Grow.jsx';
import FollowBack from './instagram/FollowBack.jsx';
import Audience from './instagram/Audience.jsx';
import Messages from './instagram/Messages.jsx';
import Content from './instagram/Content.jsx';
import IgSettings from './instagram/IgSettings.jsx';
import { igImg } from './instagram/shared.jsx';
import { RdActivity, RdArchive, RdCommunities, RdConnect, RdOverview, RdPurge, RdSettings } from './reddit/pages.jsx';

// `jobs` lists the job types whose activity shows as a spinner on that nav item.
const PLATFORMS = {
  discord: {
    name: 'Discord',
    color: '#5865f2',
    Connect,
    session: (state) => ({ connected: state.connected, demo: state.demo, name: state.user?.name, handle: state.user && `@${state.user.username}`, avatar: state.user && avatarUrl(state.user.id, state.user.avatar) }),
    ownsJob: (job) => !/^(ig|rd)-/.test(job.type),
    nav: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, page: Overview },
      { id: 'purge', label: 'Purge', icon: Trash2, page: Purge, jobs: ['purge'] },
      { id: 'nuke', label: 'Nuke', icon: Bomb, page: Nuke, jobs: ['nuke'], danger: true },
      { id: 'archive', label: 'Archive', icon: ArchiveIcon, page: Archive, jobs: ['archive'] },
      { id: 'vault', label: 'Vault', icon: Database, page: Vault },
      { id: 'logger', label: 'Live Logger', icon: Radio, page: Logger },
      { id: 'insights', label: 'Insights', icon: BarChart3, page: Insights },
      { id: 'settings', label: 'Settings', icon: SettingsIcon, page: Settings },
    ],
  },
  instagram: {
    name: 'Instagram',
    color: '#e1306c',
    Connect: IgConnect,
    session: (state) => {
      const ig = state.instagram;
      return { connected: ig.connected, demo: ig.demo, name: ig.user?.fullName || ig.user?.username, handle: ig.user && `@${ig.user.username}`, avatar: igImg(ig.user?.pic) };
    },
    ownsJob: (job) => job.type.startsWith('ig-'),
    nav: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, page: IgOverview, jobs: ['ig-sync'] },
      { id: 'autopilot', label: 'Autopilot', icon: Bot, page: Autopilot, jobs: ['ig-autopilot'] },
      { id: 'grow', label: 'Grow', icon: TrendingUp, page: Grow, jobs: ['ig-discover'] },
      { id: 'followback', label: 'Follow Back', icon: HeartHandshake, page: FollowBack, jobs: ['ig-followback', 'ig-follow'] },
      { id: 'audience', label: 'Audience', icon: Users, page: Audience, jobs: ['ig-unfollow'] },
      { id: 'messages', label: 'Messages', icon: MessagesSquare, page: Messages, jobs: ['ig-dm'] },
      { id: 'content', label: 'Content', icon: ImageIcon, page: Content, jobs: ['ig-posts', 'ig-post-comments', 'ig-activity-scan', 'ig-activity-delete', 'ig-unlike'] },
      { id: 'settings', label: 'Settings', icon: SettingsIcon, page: IgSettings },
    ],
  },
  reddit: {
    name: 'Reddit',
    color: '#ff4500',
    Connect: RdConnect,
    session: (state) => {
      const { connected, demo, user } = state.reddit;
      return { connected, demo, name: user?.name, handle: user && `u/${user.name}`, avatar: user?.icon };
    },
    ownsJob: (job) => job.type.startsWith('rd-'),
    nav: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, page: RdOverview },
      { id: 'purge', label: 'Purge', icon: Trash2, page: RdPurge, jobs: ['rd-purge'], danger: true },
      { id: 'activity', label: 'Activity', icon: Bookmark, page: RdActivity, jobs: ['rd-activity'] },
      { id: 'communities', label: 'Communities', icon: Users, page: RdCommunities, jobs: ['rd-leave'] },
      { id: 'archive', label: 'Archive', icon: ArchiveIcon, page: RdArchive, jobs: ['rd-archive'] },
      { id: 'settings', label: 'Settings', icon: SettingsIcon, page: RdSettings },
    ],
  },
};
const COMING_SOON = [
  { name: 'X', color: '#e7e7ea' },
  { name: 'Telegram', color: '#29a9eb' },
];

export function Brand({ size = 'md' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cx('rounded-full bg-accent-400', size === 'lg' ? 'size-3' : 'size-2')} />
      <span className={cx('font-display font-semibold tracking-tight text-zinc-100', size === 'lg' ? 'text-2xl' : 'text-[15px]')}>pretty suite</span>
    </div>
  );
}

function SignIn({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    api.post('/api/auth/login', { password }).then(onDone, (err) => setError(err.message));
  };
  return (
    <form onSubmit={submit} className="mx-auto grid h-screen max-w-xs content-center gap-3 px-4">
      <Brand size="lg" />
      <p className="text-sm text-zinc-500">Enter the password this Pretty Suite was set up with.</p>
      <input className="input" type="password" autoFocus autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <button className="btn btn-primary" disabled={!password}>Sign in</button>
    </form>
  );
}

function remembered() {
  try {
    return localStorage.getItem('platform');
  } catch {
    return null;
  }
}

/** Routes look like #/instagram/grow. A bare #/purge (older links) means Discord. */
function currentRoute() {
  const [first, second] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (PLATFORMS[first]) return { platform: first, page: second || 'overview' };
  return { platform: first ? 'discord' : PLATFORMS[remembered()] ? remembered() : 'discord', page: first || 'overview' };
}

export default function App() {
  const [state, setState] = useState(null);
  const [route, setRoute] = useState(currentRoute);
  const jobs = useJobs();

  // Only asked for when the app was set up with a password (remote access).
  const [locked, setLocked] = useState(false);
  const refresh = () => api.get('/api/state').then(setState);
  useEffect(() => {
    api.get('/api/auth').then((auth) => (auth.required && !auth.ok ? setLocked(true) : refresh()));
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEvent('session', refresh);
  useEvent('logger', (logger) => setState((s) => s && { ...s, logger }));
  useEvent('live', ({ captured }) => captured && setState((s) => s && { ...s, logger: { ...s.logger, captured } }));
  // Instagram counts (followers, daily limits) move as jobs finish.
  const igDone = jobs.filter((j) => /^(ig|rd)-/.test(j.type) && j.status !== 'running').length;
  useEffect(() => {
    if (igDone) refresh();
  }, [igDone]);

  if (locked) return <SignIn onDone={() => (setLocked(false), refresh())} />;
  if (!state) {
    return (
      <div className="grid h-screen place-items-center text-zinc-500">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const platform = PLATFORMS[route.platform];
  const session = platform.session(state);
  const active = platform.nav.find((n) => n.id === route.page) || platform.nav[0];
  const Page = active.page;
  const navigate = (platformId, page = 'overview') => {
    try {
      localStorage.setItem('platform', platformId);
    } catch {}
    window.location.hash = `/${platformId}/${page}`;
  };
  const go = (page) => navigate(route.platform, page);
  const platformJobs = jobs.filter(platform.ownsJob);
  const running = platformJobs.filter((j) => j.status === 'running');
  const logging = state.logger.status === 'connected';

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.07] p-4">
        <div className="px-1.5 py-1">
          <Brand />
        </div>

        <div className="mt-6 flex gap-1.5 px-1">
          {Object.entries(PLATFORMS).map(([id, p]) => (
            <button
              key={id}
              title={p.name}
              onClick={() => navigate(id)}
              className={cx(
                'relative grid size-8 cursor-pointer place-items-center rounded-full border text-[11px] font-semibold transition-colors',
                id === route.platform ? 'border-white/25 bg-white/[0.07]' : 'border-white/[0.07] hover:bg-white/[0.04]'
              )}
              style={{ color: p.color }}
            >
              {p.name[0]}
              {p.session(state).connected && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border border-black bg-emerald-400" />}
            </button>
          ))}
          {COMING_SOON.map((p) => (
            <div key={p.name} title={`${p.name} — coming soon`} className="grid size-8 place-items-center rounded-full border border-white/[0.05] text-[11px] font-semibold opacity-30" style={{ color: p.color }}>
              {p.name[0]}
            </div>
          ))}
        </div>
        <div className="mt-2 px-1.5 text-[11px] text-zinc-500">{platform.name}</div>

        <nav className="mt-4 flex flex-1 flex-col gap-0.5">
          {session.connected &&
            platform.nav.map((item) => {
              const selected = item.id === active.id;
              return (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  className={cx(
                    'group flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] transition-colors',
                    selected ? 'bg-white/[0.06] font-medium text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.035] hover:text-zinc-200'
                  )}
                >
                  <item.icon className={cx('size-4', selected && (item.danger ? 'text-red-400' : 'text-accent-300'))} />
                  {item.label}
                  {item.id === 'logger' && logging && <span className="ml-auto size-2 animate-pulse rounded-full bg-emerald-400" />}
                  {item.jobs && running.some((j) => item.jobs.includes(j.type)) && <Loader2 className="ml-auto size-3.5 animate-spin text-accent-300" />}
                </button>
              );
            })}
        </nav>

        {session.connected && (
          <div className="card flex items-center gap-2.5 p-2.5">
            <Avatar size={34} name={session.name || '?'} src={session.avatar} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{session.name}</div>
              <div className="truncate text-[11px] text-zinc-500">{session.demo ? 'Demo account' : session.handle}</div>
            </div>
          </div>
        )}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {session.connected && session.demo && (
          <div className="border-b border-amber-400/20 bg-amber-400/10 px-8 py-2 text-xs text-amber-200">
            Demo mode — this is a simulated account. Nothing here touches {platform.name}.
          </div>
        )}
        {session.connected ? (
          <div className="mx-auto max-w-6xl px-8 py-8">
            <Page key={`${route.platform}/${active.id}`} state={state} jobs={platformJobs} go={go} refresh={refresh} />
          </div>
        ) : (
          <platform.Connect key={route.platform} onConnected={refresh} remote={state.remote} />
        )}
      </main>
    </div>
  );
}
