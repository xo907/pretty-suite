import { useEffect, useState } from 'react';
import { Archive, Heart, HeartOff, Image as ImageIcon, MessageCircle, ScanSearch, Trash2 } from 'lucide-react';
import { api, fmtNumber, fmtTime, useFetch } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { Box } from '../components/TargetPicker.jsx';
import { Card, Empty, ErrorNote, Modal, PageHeader, Segmented, Toggle, cx } from '../ui.jsx';
import { finishedCount, igImg, latestJob, startIgJob, useSelection } from './shared.jsx';

const split = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

function Posts({ jobs }) {
  const [posts, setPosts] = useState([]);
  const [next, setNext] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState(null);
  const pick = useSelection();
  const job = latestJob(jobs, 'ig-posts');
  const busy = job?.status === 'running';
  const done = finishedCount(jobs);

  const load = (cursor) =>
    api.get(`/api/ig/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`).then((page) => {
      setPosts((list) => (cursor ? [...list, ...page.items] : page.items));
      setNext(page.next);
    });
  useEffect(() => {
    load(null).catch((err) => setError(err.message));
  }, [done]);

  const run = (action) => {
    setConfirm(null);
    startIgJob('ig-posts', { ids: pick.ids, action }).then(pick.clear).catch((err) => setError(err.message));
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="text-sm text-zinc-400">{pick.ids.length ? `${pick.ids.length} selected` : `${posts.length} posts loaded`}</span>
        <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => (pick.ids.length ? pick.clear() : pick.set(posts.map((p) => p.id)))}>
          {pick.ids.length ? 'Clear selection' : 'Select all loaded'}
        </button>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost" disabled={!pick.ids.length || busy} onClick={() => setConfirm('archive')}>
            <Archive className="size-4" /> Archive
          </button>
          <button className="btn btn-danger" disabled={!pick.ids.length || busy} onClick={() => setConfirm('delete')}>
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>

      {posts.length === 0 ? (
        <div className="card">
          <Empty icon={ImageIcon} title="No posts found" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {posts.map((post) => (
            <div
              key={post.id}
              onClick={() => pick.toggle(post.id)}
              className={cx('card group relative cursor-pointer overflow-hidden p-0 text-left transition', pick.has(post.id) && 'border-accent-400/70 ring-2 ring-accent-500/30')}
            >
              <div className="grid aspect-square place-items-center bg-white/[0.03]">
                {post.thumb ? <img src={igImg(post.thumb)} alt="" loading="lazy" className="size-full object-cover" /> : <ImageIcon className="size-8 text-zinc-600" />}
              </div>
              <div className="absolute top-2 left-2">
                <Box state={pick.has(post.id)} onClick={() => {}} />
              </div>
              <div className="p-3">
                <div className="truncate text-xs text-zinc-300">{post.caption || 'No caption'}</div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1"><Heart className="size-3" /> {fmtNumber(post.likes)}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="size-3" /> {fmtNumber(post.comments)}</span>
                  <span className="ml-auto">{new Date(post.ts).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {next && (
        <button className="btn btn-ghost mt-4 w-full" onClick={() => load(next)}>
          Load older posts
        </button>
      )}
      <div className="mt-5">
        <JobPanel job={job} />
      </div>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === 'archive' ? `Archive ${pick.ids.length} post(s)?` : `Delete ${pick.ids.length} post(s)?`}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => run(confirm)}>{confirm === 'archive' ? 'Archive' : 'Delete'}</button>
          </>
        }
      >
        {confirm === 'archive'
          ? 'Archived posts are hidden from everyone but you, and can be restored from the Instagram app.'
          : 'Deleted posts go to Recently Deleted in the Instagram app for 30 days, then are gone for good — along with their likes and comments.'}
      </Modal>
    </>
  );
}

function CommentsOnMine({ jobs }) {
  const [form, setForm] = useState({ keywords: '', usernames: '', everything: false });
  const [error, setError] = useState(null);
  const job = latestJob(jobs, 'ig-post-comments');
  const busy = job?.status === 'running';
  const ready = form.everything || form.keywords.trim() || form.usernames.trim();
  const run = (dryRun) => {
    setError(null);
    startIgJob('ig-post-comments', { keywords: split(form.keywords), usernames: split(form.usernames), everything: form.everything, dryRun }).catch((err) => setError(err.message));
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card title="Comments to remove" hint="Checked across every one of your posts. Your own comments are never touched.">
          <label className="label">Containing any of these words</label>
          <input className="input" placeholder="follow for follow, check my page, dm me" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          <label className="label mt-3">Written by these accounts</label>
          <input className="input" placeholder="@spammer, @someone" value={form.usernames} onChange={(e) => setForm({ ...form, usernames: e.target.value })} />
          <div className="mt-2">
            <Toggle tone="red" checked={form.everything} onChange={(v) => setForm({ ...form, everything: v })} label="Every comment from other people" hint="Wipes the comment sections of all your posts." />
          </div>
        </Card>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-3">
          <button className="btn btn-ghost flex-1" disabled={!ready || busy} onClick={() => run(true)}>
            <ScanSearch className="size-4" /> Count first
          </button>
          <button className="btn btn-danger flex-1" disabled={!ready || busy} onClick={() => run(false)}>
            <Trash2 className="size-4" /> Delete matching
          </button>
        </div>
      </div>
      <div>
        {job ? <JobPanel job={job} /> : <div className="card"><Empty icon={MessageCircle} title="Nothing run yet">Count first to see how many comments match before deleting anything.</Empty></div>}
      </div>
    </div>
  );
}

function Elsewhere({ jobs }) {
  const done = finishedCount(jobs);
  const { data } = useFetch('/api/ig/activity/comments', [done]);
  const [maxPosts, setMaxPosts] = useState(100);
  const [unlikeCount, setUnlikeCount] = useState(100);
  const [error, setError] = useState(null);
  const pick = useSelection();
  const job = latestJob(jobs, 'ig-activity-scan', 'ig-activity-delete', 'ig-unlike');
  const busy = job?.status === 'running';
  const comments = data || [];
  const allSelected = comments.length > 0 && comments.every((c) => pick.has(c.id));
  const start = (type, config) => {
    setError(null);
    startIgJob(type, config).then(pick.clear).catch((err) => setError(err.message));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card title="Find my comments" hint="Instagram has no list of comments you have left, so Pretty Suite looks through the posts you have liked — where most of your comments are.">
          <label className="label flex justify-between">
            <span>Liked posts to look through</span>
            <span className="text-zinc-300">{maxPosts}</span>
          </label>
          <input type="range" min="20" max="2000" step="20" value={maxPosts} onChange={(e) => setMaxPosts(Number(e.target.value))} className="w-full accent-accent-500" />
          <button className="btn btn-primary mt-3 w-full" disabled={busy} onClick={() => start('ig-activity-scan', { maxPosts })}>
            <ScanSearch className="size-4" /> Find my comments
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            Comments on posts you did not like, or buried deep in very busy threads, will not be found this way.
          </p>
        </Card>

        <Card title="Remove my likes" hint="Unlikes your most recently liked posts.">
          <label className="label flex justify-between">
            <span>How many</span>
            <span className="text-zinc-300">{unlikeCount}</span>
          </label>
          <input type="range" min="10" max="2000" step="10" value={unlikeCount} onChange={(e) => setUnlikeCount(Number(e.target.value))} className="w-full accent-accent-500" />
          <button className="btn btn-ghost mt-3 w-full" disabled={busy} onClick={() => start('ig-unlike', { limit: unlikeCount })}>
            <HeartOff className="size-4" /> Unlike {unlikeCount} posts
          </button>
        </Card>
        <ErrorNote>{error}</ErrorNote>
      </div>

      <div className="space-y-5">
        <JobPanel job={job} />
        <Card
          title={`My comments on other people's posts · ${comments.length}`}
          action={
            <button className="btn btn-danger px-3 py-1.5 text-xs" disabled={!pick.ids.length || busy} onClick={() => start('ig-activity-delete', { ids: pick.ids })}>
              <Trash2 className="size-3.5" /> Delete {pick.ids.length || ''}
            </button>
          }
        >
          {comments.length === 0 ? (
            <Empty icon={MessageCircle} title="None found yet">Run Find my comments and they will be listed here.</Empty>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2.5 px-2.5">
                <Box state={allSelected} onClick={() => (allSelected ? pick.clear() : pick.set(comments.map((c) => c.id)))} />
                <span className="text-xs text-zinc-500">{pick.ids.length ? `${pick.ids.length} selected` : 'Select all'}</span>
              </div>
              <div className="max-h-[30rem] overflow-y-auto">
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]">
                    <div className="pt-0.5"><Box state={pick.has(c.id)} onClick={() => pick.toggle(c.id)} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm break-words text-zinc-200">{c.text}</div>
                      <div className="text-xs text-zinc-500">
                        on{' '}
                        <a className="hover:underline" href={`https://www.instagram.com/p/${c.code}/`} target="_blank" rel="noreferrer">
                          @{c.postOwner}'s post
                        </a>{' '}
                        · {fmtTime(c.ts)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

const TABS = [
  { value: 'posts', label: 'My posts' },
  { value: 'comments', label: 'Comments on my posts' },
  { value: 'elsewhere', label: 'My comments & likes elsewhere' },
];

export default function Content({ jobs }) {
  const [tab, setTab] = useState('posts');
  return (
    <>
      <PageHeader icon={ImageIcon} title="Content" subtitle="Your posts, the comments under them, and the trail you have left on other people's.">
        <Segmented value={tab} onChange={setTab} options={TABS} />
      </PageHeader>
      {tab === 'posts' && <Posts jobs={jobs} />}
      {tab === 'comments' && <CommentsOnMine jobs={jobs} />}
      {tab === 'elsewhere' && <Elsewhere jobs={jobs} />}
    </>
  );
}
