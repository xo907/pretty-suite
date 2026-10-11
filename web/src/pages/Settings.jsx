import { useState } from 'react';
import { FolderLock, LogOut, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { api, avatarUrl } from '../api.js';
import { Avatar, Card, ErrorNote, Modal, PageHeader } from '../ui.jsx';

export default function Settings({ state, refresh }) {
  const [error, setError] = useState(null);
  const [wiping, setWiping] = useState(false);
  const [note, setNote] = useState(null);

  const disconnect = () => api.post('/api/discord/disconnect').then(refresh).catch((err) => setError(err.message));
  const wipe = async () => {
    setWiping(false);
    const { removed } = await api.post('/api/vault/wipe', {});
    setNote(`Removed ${removed.toLocaleString()} message(s) from the vault.`);
  };

  return (
    <>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Your account and your data." />
      <div className="max-w-2xl space-y-5">
        <ErrorNote>{error}</ErrorNote>

        <Card title="Discord account">
          <div className="flex items-center gap-3">
            <Avatar size={44} name={state.user.name} src={avatarUrl(state.user.id, state.user.avatar)} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{state.user.name}</div>
              <div className="text-xs text-zinc-500">{state.demo ? 'Demo account' : `@${state.user.username} · ${state.user.id}`}</div>
            </div>
            <button className="btn btn-ghost" onClick={disconnect}>
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">Disconnecting stops the live logger and forgets the saved token on this device.</p>
        </Card>

        <Card title="Where your data lives">
          <div className="flex items-start gap-3">
            <FolderLock className="mt-0.5 size-5 shrink-0 text-accent-300" />
            <div className="min-w-0">
              <dl className="space-y-2 text-sm">
                {[['Database and sessions', state.dataDir], ['Archived attachments', state.contentDir], ['Cache', state.cacheDir]].map(([label, dir]) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                    <dd className="font-mono break-all text-zinc-200">{dir}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-zinc-500">
                Everything is stored in these folders and nowhere else. To move one (for example, attachments to a bigger disk), set{' '}
                <span className="font-mono text-zinc-400">PRETTY_CONTENT_DIR</span> in the <span className="font-mono text-zinc-400">.env</span> file, move the folder, and restart.
              </p>
            </div>
          </div>
        </Card>

        <Card title="Danger zone">
          <div className="flex items-center gap-3">
            <div className="flex-1 text-sm text-zinc-300">
              Empty the vault
              <div className="text-xs text-zinc-500">Deletes every archived and logged message from this computer. Discord is not affected.</div>
            </div>
            <button className="btn btn-ghost text-red-300" onClick={() => setWiping(true)}>
              <Trash2 className="size-4" /> Empty vault
            </button>
          </div>
          {note && <div className="mt-3 text-xs text-emerald-300">{note}</div>}
        </Card>
      </div>

      <Modal
        open={wiping}
        onClose={() => setWiping(false)}
        title="Empty the vault?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setWiping(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={wipe}>Empty vault</button>
          </>
        }
      >
        Every archived and logged message, and every downloaded attachment, will be removed from this computer. This cannot be undone.
      </Modal>
    </>
  );
}
