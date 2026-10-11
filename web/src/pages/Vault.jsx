import { useEffect, useState } from 'react';
import { Database, Download, Search, Trash2 } from 'lucide-react';
import { api, fmtNumber, qs, useFetch } from '../api.js';
import MessageRow from '../components/MessageRow.jsx';
import { Chip, Empty, Modal, PageHeader, Segmented, cx } from '../ui.jsx';

const PAGE = 60;
const FLAGS = [
  ['deleted', 'Deleted'],
  ['edited', 'Edited'],
  ['flagged', 'Keyword hits'],
];

export default function Vault() {
  const summary = useFetch('/api/vault/summary');
  const [filters, setFilters] = useState({ q: '', channel: '', mine: '', source: '', deleted: '', edited: '', flagged: '' });
  const [result, setResult] = useState({ total: 0, messages: [] });
  const [wiping, setWiping] = useState(false);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const query = qs(filters);

  const load = (offset) =>
    api.get(`/api/vault/messages?${qs({ ...filters, limit: PAGE, offset })}`).then((page) =>
      setResult((prev) => (offset ? { total: page.total, messages: [...prev.messages, ...page.messages] } : page))
    );
  useEffect(() => {
    const timer = setTimeout(() => load(0), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const wipe = async () => {
    setWiping(false);
    await api.post('/api/vault/wipe', Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
    summary.reload();
    load(0);
  };

  const channels = summary.data || [];
  const everything = channels.reduce((sum, c) => sum + c.count, 0);

  return (
    <>
      <PageHeader icon={Database} title="Vault" subtitle="Everything you have archived or logged, searchable and exportable.">
        <div className="group relative">
          <button className="btn btn-ghost" disabled={!result.total}>
            <Download className="size-4" /> Export
          </button>
          <div className="invisible absolute right-0 z-10 pt-1 opacity-0 transition group-hover:visible group-hover:opacity-100">
            <div className="card w-36 bg-[#14141f] p-1">
              {['html', 'json', 'csv', 'txt'].map((format) => (
                <a
                  key={format}
                  href={`/api/vault/export?${qs({ ...filters, format })}`}
                  className="block rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
                >
                  As {format.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        </div>
        <button className="btn btn-ghost" disabled={!result.total} onClick={() => setWiping(true)} title="Remove the shown messages from the vault">
          <Trash2 className="size-4" />
        </button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="card h-fit max-h-[70vh] overflow-y-auto p-2">
          <button
            onClick={() => set('channel', '')}
            className={cx('flex w-full cursor-pointer justify-between rounded-lg px-3 py-2 text-sm', !filters.channel ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5')}
          >
            Everything <span className="text-xs text-zinc-500">{fmtNumber(everything)}</span>
          </button>
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => set('channel', c.id)}
              className={cx('flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left', filters.channel === c.id ? 'bg-white/10' : 'hover:bg-white/5')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-zinc-200">{c.guild_name ? `#${c.name ?? c.id}` : c.name ?? c.id}</span>
                <span className="block truncate text-[11px] text-zinc-500">{c.guild_name || 'Direct message'}</span>
              </span>
              <span className="text-xs text-zinc-500">{fmtNumber(c.count)}</span>
            </button>
          ))}
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
              <input className="input pl-9" placeholder="Search message text" value={filters.q} onChange={(e) => set('q', e.target.value)} />
            </div>
            <Segmented
              value={filters.mine}
              onChange={(v) => set('mine', v)}
              options={[
                { value: '', label: 'Everyone' },
                { value: '1', label: 'Mine' },
                { value: '0', label: 'Others' },
              ]}
            />
            <Segmented
              value={filters.source}
              onChange={(v) => set('source', v)}
              options={[
                { value: '', label: 'All sources' },
                { value: 'archive', label: 'Archive' },
                { value: 'live', label: 'Live' },
                { value: 'purge', label: 'Purged' },
              ]}
            />
            {FLAGS.map(([key, label]) => (
              <Chip key={key} active={filters[key] === '1'} onClick={() => set(key, filters[key] ? '' : '1')}>
                {label}
              </Chip>
            ))}
          </div>

          <div className="mb-2 text-xs text-zinc-500">{fmtNumber(result.total)} message(s)</div>
          {result.messages.length === 0 ? (
            <div className="card">
              <Empty icon={Database} title="Nothing here yet">Run an archive or start the live logger and your messages will collect here.</Empty>
            </div>
          ) : (
            <div className="space-y-2">
              {result.messages.map((m) => (
                <MessageRow key={m.id} message={m} showWhere={!filters.channel} />
              ))}
              {result.messages.length < result.total && (
                <button className="btn btn-ghost w-full" onClick={() => load(result.messages.length)}>
                  Load more
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={wiping}
        onClose={() => setWiping(false)}
        title="Remove from vault?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setWiping(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={wipe}>Remove {fmtNumber(result.total)}</button>
          </>
        }
      >
        This removes the {fmtNumber(result.total)} message(s) matching the current view from your local vault. It does not touch Discord.
      </Modal>
    </>
  );
}
