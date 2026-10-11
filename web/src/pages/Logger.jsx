import { useEffect, useState } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import { api, fmtNumber, useEvent } from '../api.js';
import MessageRow from '../components/MessageRow.jsx';
import TargetPicker from '../components/TargetPicker.jsx';
import { Card, Chip, Empty, ErrorNote, PageHeader, Segmented, Toggle, cx } from '../ui.jsx';

const STATUS = {
  connected: ['Recording', 'bg-emerald-400'],
  connecting: ['Connecting', 'bg-amber-400'],
  reconnecting: ['Reconnecting', 'bg-amber-400'],
  stopped: ['Stopped', 'bg-zinc-600'],
};
const KINDS = [
  ['all', 'All'],
  ['delete', 'Deletions'],
  ['edit', 'Edits'],
  ['flag', 'Keyword hits'],
];

export default function Logger({ state }) {
  const logger = state.logger;
  const [rules, setRules] = useState(logger.rules);
  const [keywordText, setKeywordText] = useState(logger.rules.keywords.join(', '));
  const [feed, setFeed] = useState([]);
  const [show, setShow] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/vault/messages?source=live&limit=40').then((r) => setFeed(r.messages));
  }, []);
  useEvent('live', ({ message }) => {
    if (message) setFeed((list) => [message, ...list.filter((m) => m.id !== message.id)].slice(0, 300));
  });

  const save = (patch) => {
    const next = { ...rules, ...patch };
    setRules(next);
    api.put('/api/logger/rules', next).catch((err) => setError(err.message));
  };
  const toggle = () => api.post(`/api/logger/${logger.status === 'stopped' ? 'start' : 'stop'}`).catch((err) => setError(err.message));

  const [label, dot] = STATUS[logger.status] || STATUS.stopped;
  const running = logger.status !== 'stopped';
  const visible = feed.filter((m) => show === 'all' || (show === 'delete' && m.deleted_ts) || (show === 'edit' && m.edits?.length) || (show === 'flag' && m.flagged));

  return (
    <>
      <PageHeader icon={Radio} title="Live Logger" subtitle="Record messages the moment they arrive — including the ones that get edited or deleted later.">
        <span className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-300">
          <span className={cx('size-2 rounded-full', dot, logger.status === 'connected' && 'animate-pulse')} /> {label}
        </span>
        <button className={cx('btn', running ? 'btn-ghost' : 'btn-primary')} onClick={toggle}>
          {running ? <Pause className="size-4" /> : <Play className="size-4" />} {running ? 'Stop' : 'Start logging'}
        </button>
      </PageHeader>

      <ErrorNote>{error || logger.error}</ErrorNote>

      <div className="mt-1 grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="What to record" hint="Changes apply instantly, even while recording.">
            <Segmented
              value={rules.scope}
              onChange={(scope) => save({ scope })}
              options={[
                { value: 'all', label: 'Everything I can see' },
                { value: 'custom', label: 'Only what I pick' },
              ]}
            />
            <div className="mt-3">
              <Toggle checked={rules.captureMine} onChange={(v) => save({ captureMine: v })} label="My messages" />
              <Toggle checked={rules.captureOthers} onChange={(v) => save({ captureOthers: v })} label="Other people's messages" />
              {rules.scope === 'custom' && (
                <Toggle checked={rules.allDms} onChange={(v) => save({ allDms: v })} label="All direct messages" hint="Including conversations that start later." />
              )}
              <Toggle
                checked={rules.downloadAttachments}
                onChange={(v) => save({ downloadAttachments: v })}
                label="Save attachments"
                hint="Download files as they are posted, before they can be removed."
              />
            </div>
            <label className="label mt-3">Keyword alerts</label>
            <input
              className="input"
              placeholder="e.g. my name, project x"
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
              onBlur={() => save({ keywords: keywordText.split(',').map((k) => k.trim()).filter(Boolean) })}
            />
          </Card>

          {rules.scope === 'custom' && (
            <TargetPicker value={rules.selection} onChange={(selection) => save({ selection })} className="h-[26rem]" />
          )}
        </div>

        <Card
          title="Live feed"
          hint={`${fmtNumber(logger.captured)} captured this session`}
          action={
            <div className="flex flex-wrap justify-end gap-1.5">
              {KINDS.map(([key, text]) => (
                <Chip key={key} active={show === key} onClick={() => setShow(key)}>
                  {text}
                </Chip>
              ))}
            </div>
          }
        >
          {visible.length === 0 ? (
            <Empty icon={Radio} title={running ? 'Listening…' : 'The logger is off'}>
              {running ? 'New messages will appear here as they happen.' : 'Start logging to capture messages in real time.'}
            </Empty>
          ) : (
            <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
              {visible.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
