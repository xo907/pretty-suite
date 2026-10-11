import { useState } from 'react';
import { Bomb, MessagesSquare, Server } from 'lucide-react';
import { api, fmtNumber, useFetch } from '../api.js';
import JobPanel from '../components/JobPanel.jsx';
import { ErrorNote, PageHeader, Toggle } from '../ui.jsx';

export default function Nuke({ state, jobs, go }) {
  const { data: pkg } = useFetch('/api/discord/package');
  const [phrase, setPhrase] = useState('');
  const [options, setOptions] = useState({ safetyNet: true, scramble: false });
  const [error, setError] = useState(null);

  const job = jobs.find((j) => j.type === 'nuke');
  const busy = job?.status === 'running';
  const armed = phrase === 'NUKE';

  const launch = async () => {
    setError(null);
    try {
      await api.post('/api/jobs', { type: 'purge', config: { nuke: true, confirm: phrase, ...options, delayMs: 900 } });
      setPhrase('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader icon={Bomb} tone="red" title="Nuke" subtitle="One switch. Every message you have sent, everywhere, gone." />

      <div className="card rise relative overflow-hidden border-red-500/25 p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-red-500/15 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-xl font-semibold">Blast radius</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Nuke walks every open conversation and every server you are in, deleting all of your messages. It cannot be undone on Discord.
            </p>
            <div className="mt-5 flex gap-4">
              <div className="rounded-xl border border-white/8 bg-black/30 px-5 py-3">
                <MessagesSquare className="size-4 text-red-300" />
                <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{fmtNumber(state.counts.dms)}</div>
                <div className="text-[11px] tracking-wide text-zinc-500 uppercase">Conversations</div>
              </div>
              <div className="rounded-xl border border-white/8 bg-black/30 px-5 py-3">
                <Server className="size-4 text-red-300" />
                <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{fmtNumber(state.counts.guilds)}</div>
                <div className="text-[11px] tracking-wide text-zinc-500 uppercase">Servers</div>
              </div>
            </div>
            {pkg?.imported ? (
              <p className="mt-5 text-xs leading-relaxed text-zinc-500">
                Includes <b className="font-medium text-zinc-300">{fmtNumber(pkg.closedDms.length)} closed DM(s)</b> from your data
                package.{' '}
                {pkg.leftServers.length > 0 &&
                  `Not covered: ${fmtNumber(pkg.leftServers.length)} server(s) you left — Discord only allows deleting there after you rejoin.`}
              </p>
            ) : (
              <p className="mt-5 text-xs leading-relaxed text-zinc-500">
                Not covered yet: DMs you have closed and servers you have left, because Discord does not list them.{' '}
                <button className="cursor-pointer text-accent-300 hover:text-accent-200" onClick={() => go('purge')}>
                  Import your data package on the Purge page
                </button>{' '}
                and closed DMs are included automatically.
              </p>
            )}
          </div>

          <div>
            <Toggle
              tone="red"
              checked={options.safetyNet}
              onChange={(v) => setOptions({ ...options, safetyNet: v })}
              label="Archive everything first"
              hint="Keep a private copy of each message in your vault before it is destroyed."
            />
            <Toggle
              tone="red"
              checked={options.scramble}
              onChange={(v) => setOptions({ ...options, scramble: v })}
              label="Scramble before deleting"
              hint="Overwrite each message with random characters before removing it."
            />
            <label className="label mt-5">Type NUKE to arm</label>
            <input
              className="input font-mono tracking-[0.3em] uppercase focus:border-red-400/60 focus:ring-red-500/15"
              placeholder="NUKE"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value.toUpperCase())}
              disabled={busy}
            />
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
            <button className="btn btn-danger mt-3 w-full py-3 text-base" disabled={!armed || busy} onClick={launch}>
              <Bomb className="size-5" /> {busy ? 'Nuke in progress…' : 'Launch'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <JobPanel job={job} tone="red" />
      </div>
    </>
  );
}
