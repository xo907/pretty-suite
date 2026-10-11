import { useState } from 'react';
import { ChevronDown, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { ErrorNote, Toggle, cx } from '../ui.jsx';

export default function IgConnect({ onConnected, remote }) {
  const [cookie, setCookie] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [manual, setManual] = useState(Boolean(remote));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const run = async (kind, request) => {
    setBusy(kind);
    setError(null);
    try {
      await request();
      onConnected();
    } catch (err) {
      if (err.message !== 'Login cancelled.') setError(err.message);
    }
    setBusy(null);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card rise p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full border border-white/[0.09] text-sm font-semibold text-[#e1306c]">
            I
          </span>
          <div>
            <div className="text-sm font-semibold">Connect Instagram</div>
            <div className="text-xs text-zinc-500">Log in the way you normally do</div>
          </div>
        </div>

        {busy === 'tab' || busy === 'browser' ? (
          <div className="rounded-[14px] border border-white/[0.08] p-4 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-accent-300" />
            <div className="mt-2 text-sm font-medium">Waiting for you to log in…</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {busy === 'tab'
                ? 'If your browser asks to allow remote debugging, choose Allow. If you are not logged in to Instagram yet, a new tab opens for it: log in there and it closes by itself.'
                : 'An Instagram window has opened. Enter your username and password there, plus your two-factor code if you use one.'}{' '}
              This screen continues by itself as soon as you are in.
            </p>
            <button className="btn btn-ghost mt-3 px-3 py-1.5 text-xs" onClick={() => api.post('/api/ig/login/cancel')}>
              Cancel
            </button>
          </div>
        ) : remote ? (
          <p className="rounded-[14px] border border-white/[0.08] p-3 text-xs leading-relaxed text-zinc-400">
            This Pretty Suite runs on another machine, so it cannot open a browser for you. Paste your <span className="font-mono text-zinc-300">sessionid</span> cookie from a browser where you are logged in to instagram.com.
          </p>
        ) : (
          <>
            <button className="btn btn-primary w-full py-2.5" disabled={busy} onClick={() => run('tab', () => api.post('/api/ig/login/tab', { remember }))}>
              <ExternalLink className="size-4" /> Log in with this browser
            </button>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Uses the Instagram login of the browser you have open, in a new tab if you still need to sign in. One-time setup: open{' '}
              <span className="font-mono text-zinc-300 select-all">chrome://inspect/#remote-debugging</span> in a tab and tick "Allow remote
              debugging for this browser instance".
            </p>
            <div className="my-4 flex items-center gap-3 text-[11px] text-zinc-600">
              <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
            </div>

            <button className="btn btn-ghost w-full py-2.5" disabled={busy} onClick={() => run('browser', () => api.post('/api/ig/login/browser', { remember }))}>
              <ExternalLink className="size-4" /> Log in in a separate window
            </button>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-zinc-400">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                Either way you log in on the real instagram.com page. You type your username and password there, not here.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                Pretty Suite never sees your password — only the session, read from the browser once you're in.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                Two-factor codes and Instagram's security checks work exactly as usual.
              </li>
            </ul>
          </>
        )}

        <div className="mt-4">
          <Toggle
            checked={remember}
            onChange={setRemember}
            label="Stay connected on this device"
            hint="Keeps the session in your local app data folder so you do not log in each time. Never uploaded."
          />
        </div>

        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>

        <button type="button" className="mt-4 flex cursor-pointer items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setManual(!manual)}>
          <KeyRound className="size-3.5" /> Advanced: paste a session cookie instead
          <ChevronDown className={cx('size-3.5 transition-transform', manual && 'rotate-180')} />
        </button>
        {manual && (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              run('cookie', () => api.post('/api/ig/connect', { cookie, remember }));
            }}
          >
            <p className="mb-2 text-xs leading-relaxed text-zinc-500">
              In a browser where you are logged in to instagram.com, press F12, open
              Application → Cookies → <span className="font-mono text-zinc-300">https://www.instagram.com</span>, and copy the value of{' '}
              <span className="font-mono text-zinc-300">sessionid</span>.
            </p>
            <div className="relative">
              <input
                className="input pr-10 font-mono"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your sessionid value"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
              />
              <button type="button" className="absolute top-2.5 right-3 cursor-pointer text-zinc-500 hover:text-zinc-300" onClick={() => setShow(!show)}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <button className="btn btn-ghost mt-2 w-full" disabled={!cookie.trim() || busy}>
              {busy === 'cookie' && <Loader2 className="size-4 animate-spin" />} Connect with cookie
            </button>
          </form>
        )}

        <div className="mt-4 border-t border-white/8 pt-4">
          <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => run('demo', () => api.post('/api/ig/demo'))}>
            {busy === 'demo' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Explore with a demo account
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-100/80">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <p>
          Instagram prohibits automation and is quick to restrict accounts that follow, unfollow or message in bulk. Pretty Suite paces
          everything, caps daily actions and stops the moment Instagram pushes back, but the risk is real and yours to weigh.
        </p>
      </div>
    </div>
  );
}
