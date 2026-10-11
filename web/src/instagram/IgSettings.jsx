import { useState } from 'react';
import { LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Card, ErrorNote, PageHeader } from '../ui.jsx';
import { igImg } from './shared.jsx';

const SAFEGUARDS = [
  'Actions are paced the way a person works: uneven gaps, a changing tempo, and a short break every so often.',
  'Follows and unfollows stop at the daily limit you set, counted over the last 24 hours.',
  'If Instagram asks for a check or blocks an action, the running job stops immediately instead of retrying.',
  'Profiles are remembered for a week, so the same account is not opened again and again.',
];

export default function IgSettings({ state, refresh }) {
  const [error, setError] = useState(null);
  const { user, demo } = state.instagram;
  return (
    <>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Your Instagram connection." />
      <div className="max-w-2xl space-y-5">
        <ErrorNote>{error}</ErrorNote>
        <Card title="Instagram account">
          <div className="flex items-center gap-3">
            <Avatar size={44} name={user.username} src={igImg(user.pic)} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">@{user.username}</div>
              <div className="text-xs text-zinc-500">{demo ? 'Demo account' : user.fullName}</div>
            </div>
            <button className="btn btn-ghost" onClick={() => api.post('/api/ig/disconnect').then(refresh).catch((err) => setError(err.message))}>
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Disconnecting forgets the saved session on this device. Your sync history and never-unfollow list are kept in {state.dataDir}.
          </p>
        </Card>
        <Card title="How Pretty Suite protects the account">
          <ul className="space-y-2">
            {SAFEGUARDS.map((line) => (
              <li key={line} className="flex gap-2.5 text-sm text-zinc-300">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /> {line}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
