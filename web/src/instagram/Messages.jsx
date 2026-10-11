import { useState } from 'react';
import { Bomb, MessagesSquare, RefreshCw, Trash2 } from 'lucide-react';
import { fmtTime, useFetch } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { Box } from '../components/TargetPicker.jsx';
import { Avatar, Card, Empty, ErrorNote, Modal, PageHeader, Toggle } from '../ui.jsx';
import { finishedCount, igImg, latestJob, startIgJob, useSelection } from './shared.jsx';

function Actions({ value, onChange, tone }) {
  return (
    <>
      <Toggle
        tone={tone}
        checked={value.unsend}
        onChange={(v) => onChange({ ...value, unsend: v })}
        label="Unsend my messages"
        hint="Removes everything you sent, for both of you. The other person's messages stay."
      />
      <Toggle
        tone={tone}
        checked={value.remove}
        onChange={(v) => onChange({ ...value, remove: v })}
        label="Remove the conversation"
        hint="Clears the chat from your inbox only. On its own, the other person still sees everything."
      />
    </>
  );
}

export default function Messages({ jobs }) {
  const { data, loading, reload } = useFetch('/api/ig/threads', [finishedCount(jobs)]);
  const [actions, setActions] = useState({ unsend: true, remove: false });
  const [allActions, setAllActions] = useState({ unsend: true, remove: true });
  const [before, setBefore] = useState('');
  const [phrase, setPhrase] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const pick = useSelection();

  const job = latestJob(jobs, 'ig-dm');
  const busy = job?.status === 'running';
  const threads = data || [];
  const allSelected = threads.length > 0 && threads.every((t) => pick.has(t.id));

  const start = (config) => {
    setConfirm(false);
    setError(null);
    startIgJob('ig-dm', config).then(() => (pick.clear(), setPhrase(''))).catch((err) => setError(err.message));
  };
  const runSelected = () => start({ threadIds: pick.ids, titles: Object.fromEntries(threads.map((t) => [t.id, t.title])), before, ...actions });

  return (
    <>
      <PageHeader icon={MessagesSquare} title="Messages" subtitle="Unsend what you wrote and clear conversations, one chat or all of them.">
        <button className="btn btn-ghost" onClick={reload}>
          <RefreshCw className="size-4" /> Refresh
        </button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Card title="Conversations" hint="Your most recent chats. Purge all reaches every conversation, including ones not listed here.">
          {threads.length === 0 ? (
            <Empty icon={MessagesSquare} title={loading ? 'Loading…' : 'No conversations'} />
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2.5 px-2.5">
                <Box state={allSelected} onClick={() => (allSelected ? pick.clear() : pick.set(threads.map((t) => t.id)))} />
                <span className="text-xs text-zinc-500">{pick.ids.length ? `${pick.ids.length} selected` : 'Select all'}</span>
              </div>
              <div className="max-h-[36rem] overflow-y-auto">
                {threads.map((thread) => (
                  <div key={thread.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]">
                    <Box state={pick.has(thread.id)} onClick={() => pick.toggle(thread.id)} />
                    <Avatar size={36} name={thread.title || '?'} src={igImg(thread.users[0]?.pic)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-100">{thread.title}</div>
                      <div className="truncate text-xs text-zinc-500">{thread.lastText || 'No preview'}</div>
                    </div>
                    <span className="text-xs text-zinc-600">{fmtTime(thread.lastTs)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="For the selected conversations">
            <Actions value={actions} onChange={setActions} />
            <label className="label mt-3">Only messages sent before (optional)</label>
            <input type="datetime-local" className="input" value={before} onChange={(e) => setBefore(e.target.value)} />
            <button className="btn btn-primary mt-4 w-full" disabled={!pick.ids.length || busy || (!actions.unsend && !actions.remove)} onClick={() => setConfirm(true)}>
              <Trash2 className="size-4" /> Run on {pick.ids.length || 'selected'}
            </button>
          </Card>

          <Card title="Purge all messages" className="border-red-500/25">
            <p className="mb-2 text-xs leading-relaxed text-zinc-400">
              Walks your entire inbox, conversation by conversation. Unsent messages cannot be recovered.
            </p>
            <Actions value={allActions} onChange={setAllActions} tone="red" />
            <label className="label mt-3">Type PURGE to arm</label>
            <input
              className="input font-mono tracking-[0.3em] uppercase focus:border-red-400/60"
              placeholder="PURGE"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value.toUpperCase())}
            />
            <button
              className="btn btn-danger mt-3 w-full"
              disabled={phrase !== 'PURGE' || busy || (!allActions.unsend && !allActions.remove)}
              onClick={() => start({ all: true, confirm: phrase, ...allActions })}
            >
              <Bomb className="size-4" /> Purge everything
            </button>
          </Card>
          <ErrorNote>{error}</ErrorNote>
        </div>
      </div>

      <div className="mt-6">
        <JobPanel job={job} tone="red" />
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Clean ${pick.ids.length} conversation(s)?`}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={runSelected}>Yes, go ahead</button>
          </>
        }
      >
        {actions.unsend && 'Your messages in these chats will be unsent for everyone. '}
        {actions.remove && 'The conversations will be removed from your inbox. '}
        This cannot be undone.
      </Modal>
    </>
  );
}
