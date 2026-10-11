import { useState } from 'react';
import { ChevronDown, Eye, EyeOff, Loader2, Lock, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { Brand } from '../App.jsx';
import { ErrorNote, Toggle, cx } from '../ui.jsx';

export default function Connect({ onConnected }) {
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const run = async (kind, request) => {
    setBusy(kind);
    setError(null);
    try {
      await request();
      onConnected();
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand size="lg" />
          <p className="mt-4 max-w-sm text-sm text-zinc-400">
            Take back control of your social footprint. Purge, archive and log your Discord — free, and entirely on your machine.
          </p>
        </div>

        <form
          className="card rise p-6"
          onSubmit={(e) => {
            e.preventDefault();
            run('connect', () => api.post('/api/discord/connect', { token, remember }));
          }}
        >
          <div className="mb-4 flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-blurple text-sm font-bold text-white">D</span>
            <div>
              <div className="text-sm font-semibold">Connect Discord</div>
              <div className="text-xs text-zinc-500">Sign in with your account token</div>
            </div>
          </div>

          <label className="label" htmlFor="token">Account token</label>
          <div className="relative">
            <input
              id="token"
              className="input pr-10 font-mono"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button type="button" className="absolute top-2.5 right-3 cursor-pointer text-zinc-500 hover:text-zinc-300" onClick={() => setShow(!show)}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          <button type="button" className="mt-2 flex cursor-pointer items-center gap-1 text-xs text-accent-300 hover:text-accent-200" onClick={() => setHelp(!help)}>
            Where do I find my token? <ChevronDown className={cx('size-3.5 transition-transform', help && 'rotate-180')} />
          </button>
          {help && (
            <ol className="mt-2 list-decimal space-y-1 rounded-xl border border-white/8 bg-black/30 py-3 pr-3 pl-7 text-xs text-zinc-400">
              <li>Open Discord in your browser and sign in.</li>
              <li>Press F12 and open the Network tab.</li>
              <li>Click any channel, then pick a request to <span className="font-mono text-zinc-300">discord.com/api</span>.</li>
              <li>Under Request Headers, copy the value of <span className="font-mono text-zinc-300">authorization</span>.</li>
            </ol>
          )}

          <div className="mt-3">
            <Toggle checked={remember} onChange={setRemember} label="Remember on this device" hint="Stored in your local app data folder, never uploaded." />
          </div>

          <div className="mt-3 space-y-3">
            <ErrorNote>{error}</ErrorNote>
            <button className="btn btn-primary w-full py-2.5" disabled={!token.trim() || busy}>
              {busy === 'connect' ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />} Connect account
            </button>
            <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => run('demo', () => api.post('/api/discord/demo'))}>
              {busy === 'demo' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Explore with a demo account
            </button>
          </div>
        </form>

        <div className="mt-4 flex gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-100/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <p>
            Your token is full access to your account — never share it. Automating a user account is against Discord's Terms of Service and
            carries a risk of account action; Pretty Suite paces its requests, but the risk is yours to weigh.
          </p>
        </div>
      </div>
    </div>
  );
}
