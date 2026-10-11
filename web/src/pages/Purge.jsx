import { useState } from 'react';
import { ScanSearch, Trash2 } from 'lucide-react';
import { api, toTargets } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import PackagePanel from '../components/PackagePanel.jsx';
import TargetPicker, { countSelection, emptySelection } from '../components/TargetPicker.jsx';
import { Card, Chip, ErrorNote, Modal, PageHeader, Segmented, Toggle } from '../ui.jsx';

const HAS = ['link', 'file', 'image', 'video', 'embed', 'sticker'];

export default function Purge({ state, jobs }) {
  const [selection, setSelection] = useState(emptySelection);
  const [closedDms, setClosedDms] = useState({});
  const [filters, setFilters] = useState({ after: '', before: '', content: '', regex: '', has: [], pinned: 'include' });
  const [options, setOptions] = useState({ scramble: false, safetyNet: true, delayMs: 1000 });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);

  const job = jobs.find((j) => j.type === 'purge');
  const busy = job?.status === 'running';
  const count = countSelection(selection) + Object.keys(closedDms).length;
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const targets = () => [...toTargets(selection), ...Object.keys(closedDms).map((id) => ({ kind: 'package', id }))];
  const finished = jobs.filter((j) => j.status !== 'running').length;

  const start = async (dryRun) => {
    setConfirm(false);
    setError(null);
    try {
      await api.post('/api/jobs', { type: 'purge', config: { targets: targets(), filters, ...options, dryRun } });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader icon={Trash2} title="Purge" subtitle="Delete your own messages across DMs and servers, as precisely as you like." />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-5">
          <TargetPicker value={selection} onChange={setSelection} className="h-[30rem]" />
          <PackagePanel value={closedDms} onChange={setClosedDms} demo={state.demo} refreshKey={finished} />
        </div>

        <div className="space-y-5">
          <Card title="Filters" hint="Leave everything blank to match all of your messages.">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Sent after</label>
                <input type="datetime-local" className="input" value={filters.after} onChange={(e) => set('after', e.target.value)} />
              </div>
              <div>
                <label className="label">Sent before</label>
                <input type="datetime-local" className="input" value={filters.before} onChange={(e) => set('before', e.target.value)} />
              </div>
              <div>
                <label className="label">Contains text</label>
                <input className="input" placeholder="any message" value={filters.content} onChange={(e) => set('content', e.target.value)} />
              </div>
              <div>
                <label className="label">Matches regex</label>
                <input className="input font-mono" placeholder="e.g. ^lol|\bbrb\b" value={filters.regex} onChange={(e) => set('regex', e.target.value)} />
              </div>
            </div>
            <label className="label mt-4">Only messages that have</label>
            <div className="flex flex-wrap gap-2">
              {HAS.map((kind) => (
                <Chip
                  key={kind}
                  active={filters.has.includes(kind)}
                  onClick={() => set('has', filters.has.includes(kind) ? filters.has.filter((k) => k !== kind) : [...filters.has, kind])}
                >
                  {kind}
                </Chip>
              ))}
            </div>
            <label className="label mt-4">Pinned messages</label>
            <Segmented
              value={filters.pinned}
              onChange={(v) => set('pinned', v)}
              options={[
                { value: 'include', label: 'Include' },
                { value: 'skip', label: 'Keep pinned' },
                { value: 'only', label: 'Only pinned' },
              ]}
            />
          </Card>

          <Card title="How to delete">
            <Toggle
              checked={options.safetyNet}
              onChange={(v) => setOptions({ ...options, safetyNet: v })}
              label="Safety net"
              hint="Save a copy of each message to your vault right before it is deleted."
            />
            <Toggle
              checked={options.scramble}
              onChange={(v) => setOptions({ ...options, scramble: v })}
              label="Scramble before deleting"
              hint="Overwrite the text with random characters first, so nothing readable lingers. About twice as slow."
            />
            <div className="mt-3">
              <label className="label flex justify-between">
                <span>Pace</span>
                <span className="text-zinc-300">{options.delayMs} ms between deletions</span>
              </label>
              <input
                type="range"
                min="300"
                max="3000"
                step="100"
                value={options.delayMs}
                onChange={(e) => setOptions({ ...options, delayMs: Number(e.target.value) })}
                className="w-full accent-accent-500"
              />
              <div className="flex justify-between text-[11px] text-zinc-600">
                <span>Faster</span>
                <span>Gentler on rate limits</span>
              </div>
            </div>
          </Card>

          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-3">
            <button className="btn btn-ghost flex-1 py-2.5" disabled={!count || busy} onClick={() => start(true)}>
              <ScanSearch className="size-4" /> Scan first
            </button>
            <button className="btn btn-primary flex-1 py-2.5" disabled={!count || busy} onClick={() => setConfirm(true)}>
              <Trash2 className="size-4" /> Purge messages
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <JobPanel job={job} />
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete these messages?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => start(false)}>Yes, delete them</button>
          </>
        }
      >
        Every message of yours matching these filters in {count} selected {count === 1 ? 'place' : 'places'} will be permanently deleted from
        Discord. {options.safetyNet ? 'A copy will be kept in your vault.' : 'No copy will be kept.'}
      </Modal>
    </>
  );
}
