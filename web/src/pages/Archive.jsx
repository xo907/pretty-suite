import { useState } from 'react';
import { Archive as ArchiveIcon, Database } from 'lucide-react';
import { api, toTargets } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import TargetPicker, { countSelection, emptySelection } from '../components/TargetPicker.jsx';
import { Card, ErrorNote, PageHeader, Segmented, Toggle } from '../ui.jsx';

export default function Archive({ jobs, go }) {
  const [selection, setSelection] = useState(emptySelection);
  const [config, setConfig] = useState({ scope: 'both', userIds: '', after: '', before: '', downloadAttachments: false });
  const [error, setError] = useState(null);

  const job = jobs.find((j) => j.type === 'archive');
  const busy = job?.status === 'running';
  const count = countSelection(selection);
  const set = (key, value) => setConfig((c) => ({ ...c, [key]: value }));

  const start = async () => {
    setError(null);
    try {
      await api.post('/api/jobs', { type: 'archive', config: { ...config, targets: toTargets(selection) } });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader icon={ArchiveIcon} title="Archive" subtitle="Save conversations to a private vault on this computer.">
        <button className="btn btn-ghost" onClick={() => go('vault')}>
          <Database className="size-4" /> Open vault
        </button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <TargetPicker value={selection} onChange={setSelection} className="h-[32rem]" />

        <div className="space-y-5">
          <Card title="Whose messages" hint="Choose exactly what ends up in the vault.">
            <Segmented
              value={config.scope}
              onChange={(v) => set('scope', v)}
              options={[
                { value: 'both', label: 'Everyone' },
                { value: 'mine', label: 'Only mine' },
                { value: 'others', label: "Only other people's" },
              ]}
            />
            <label className="label mt-4">Only these people (optional)</label>
            <input
              className="input font-mono"
              placeholder="User IDs, separated by commas"
              value={config.userIds}
              onChange={(e) => set('userIds', e.target.value)}
            />
          </Card>

          <Card title="What to save">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">From</label>
                <input type="datetime-local" className="input" value={config.after} onChange={(e) => set('after', e.target.value)} />
              </div>
              <div>
                <label className="label">Until</label>
                <input type="datetime-local" className="input" value={config.before} onChange={(e) => set('before', e.target.value)} />
              </div>
            </div>
            <div className="mt-3">
              <Toggle
                checked={config.downloadAttachments}
                onChange={(v) => set('downloadAttachments', v)}
                label="Download attachments"
                hint="Store images, videos and files locally so they survive even if the originals are deleted."
              />
            </div>
          </Card>

          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary w-full py-2.5" disabled={!count || busy} onClick={start}>
            <ArchiveIcon className="size-4" /> Start archive
          </button>
        </div>
      </div>

      <div className="mt-6">
        <JobPanel job={job} />
      </div>
    </>
  );
}
