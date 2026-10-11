// "Log in with your browser": opens the platform's real login page — in a new tab of the browser the
// user already has open, or in a separate window with its own profile — then reads the session cookies
// over the DevTools protocol once the user is in.
// The password is typed into the real site and never passes through Pretty Suite.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from './config.js';
import { findBrowserExe, installedBrowsers, profileLocked } from './browserProfiles.js';
import { HttpError, sleep } from './util.js';

const TIMEOUT_MS = 5 * 60 * 1000;
let current = null;

const profileDir = (profile) => path.join(cacheDir, profile);

export function forgetLoginProfile(profile) {
  try {
    fs.rmSync(profileDir(profile), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Still locked by a closing browser; it holds nothing we rely on.
  }
}

/** The browser writes its debugging port into its user-data-dir once it is listening. */
function readDebuggerUrl(dir) {
  try {
    const [port, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
  } catch {
    // Not written (yet).
  }
  return null;
}

async function debuggerUrl(dir, state) {
  for (let i = 0; i < 100; i++) {
    if (state.exited) break;
    const url = readDebuggerUrl(dir);
    if (url) return url;
    await sleep(150);
  }
  throw new HttpError(500, 'The login window could not be opened. If an earlier login window is still open, close it and try again.');
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    const cdp = {
      closed: false,
      /** `sessionId` addresses one attached tab; without it the command goes to the browser itself. */
      send(method, params = {}, sessionId) {
        if (cdp.closed) return Promise.reject(new Error('closed'));
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      },
      close: () => ws.close(),
    };
    ws.onopen = () => resolve(cdp);
    ws.onerror = () => reject(new HttpError(500, 'Could not talk to the login window.'));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.error ? waiter.rej(new Error(message.error.message)) : waiter.res(message.result);
    };
    ws.onclose = () => {
      cdp.closed = true;
      for (const waiter of pending.values()) waiter.rej(new Error('closed'));
    };
  });
}

/** Polls `read` until every cookie in `required` is present. `gone` returns a message once the login surface has been closed. */
async function waitForCookies({ read, required, state, gone }) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.cancelled) throw new HttpError(400, 'Login cancelled.');
    const closed = await gone();
    if (closed) throw new HttpError(400, closed);
    const jar = await read().catch(() => ({}));
    if (required.every((name) => jar[name])) {
      await sleep(1500); // let the remaining cookies land
      return { ...jar, ...(await read().catch(() => ({}))) };
    }
    await sleep(1200);
  }
  throw new HttpError(408, 'Timed out waiting for the login to finish.');
}

const cookieJar = (cookies, domain, wanted) => {
  const jar = {};
  for (const cookie of cookies) {
    if (wanted.includes(cookie.name) && cookie.value && (cookie.domain === domain || cookie.domain.endsWith(`.${domain}`))) jar[cookie.name] = cookie.value;
  }
  return jar;
};

const copyIfPresent = (from, to) => {
  if (!fs.existsSync(from)) return false;
  fs.copyFileSync(from, to);
  return true;
};

/**
 * Seeds the managed user-data-dir with a copy of one of the user's own browser profiles, so the
 * window opens already signed in. Only the cookie store and the key file are copied; the browser
 * itself does the decryption. Returns the profile sub-directory name to launch.
 */
function seedFromProfile(dir, source, browserName) {
  const name = /^[\w .-]+$/.test(source.profileDir) ? source.profileDir : 'Default';
  // The browser must be fully closed, or its cookie database is locked and cannot be copied.
  if (profileLocked(source.userData, name)) {
    throw new HttpError(409, `${browserName} is still open. Close it completely (check the taskbar and system tray), then try again.`);
  }
  const target = path.join(dir, name);
  fs.mkdirSync(path.join(target, 'Network'), { recursive: true });
  copyIfPresent(path.join(source.userData, 'Local State'), path.join(dir, 'Local State'));
  let copied = false;
  try {
    for (const rel of [['Network', 'Cookies'], ['Cookies']]) {
      const base = path.join(...rel);
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        if (copyIfPresent(path.join(source.userData, name, base + suffix), path.join(target, base + suffix)) && !suffix) copied = true;
      }
    }
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EACCES' || err.code === 'EPERM') {
      throw new HttpError(409, `${browserName} is still open. Close it completely (check the taskbar and system tray), then try again.`);
    }
    throw err;
  }
  if (!copied) throw new HttpError(409, `Could not find a cookie store for that ${browserName} profile. Pick a different profile, or log in through the window instead.`);
  return name;
}

/**
 * Opens `url` and resolves with { cookies, userAgent } once every cookie in `required` exists for `domain`.
 * `keepProfile` leaves the window's profile on disk so the next login is instant.
 * `source` ({ browser, userData, profileDir }) seeds the window from one of the user's own browser profiles.
 */
export async function browserLogin({ profile, url, domain, required, wanted = required, keepProfile, source }) {
  if (current) throw new HttpError(409, 'A login window is already open. Finish there, or cancel it first.');
  const exe = (source && findBrowserExe(source.browser)) || installedBrowsers()[0]?.exe;
  if (!exe) throw new HttpError(500, 'Could not find Chrome, Chromium, Edge or Brave on this computer. Use the session cookie option instead.');

  const dir = profileDir(profile);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const launchProfile = source ? seedFromProfile(dir, source, source.name || 'that browser') : null;

  const state = (current = { cancelled: false, exited: false });
  const child = spawn(
    exe,
    [
      `--user-data-dir=${dir}`,
      ...(launchProfile ? [`--profile-directory=${launchProfile}`] : []),
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=520,820',
      `--app=${url}`,
    ],
    { stdio: 'ignore' }
  );
  state.child = child;
  child.on('exit', () => (state.exited = true));
  child.on('error', () => (state.exited = true));

  let cdp = null;
  try {
    cdp = await connectCdp(await debuggerUrl(dir, state));
    const jar = await waitForCookies({
      read: async () => cookieJar((await cdp.send('Storage.getCookies')).cookies, domain, wanted),
      required,
      state,
      gone: () => (cdp.closed || state.exited) && 'The login window was closed before you finished logging in.',
    });
    const { userAgent } = await cdp.send('Browser.getVersion').catch(() => ({}));
    return { cookies: jar, userAgent };
  } finally {
    current = null;
    await cdp?.send('Browser.close').catch(() => {});
    cdp?.close();
    setTimeout(() => {
      if (!state.exited) child.kill();
      if (!keepProfile) setTimeout(() => forgetLoginProfile(profile), 1500);
    }, 800);
  }
}

/**
 * Same result as browserLogin, but inside the browser the user already has open: reads the session
 * straight away if they are logged in there, otherwise opens `url` in a new tab and waits.
 * Needs remote debugging allowed in that browser (chrome://inspect/#remote-debugging), which also
 * makes it ask the user to approve the connection. `origin` is Pretty Suite's own address, used to
 * find the profile it is open in and to hand focus back afterwards.
 * `afterwards(visit)` may use the same connection once login is done, without holding the login up:
 * `visit(url, expression)` loads a page in a background tab and returns what the expression evaluates to there.
 */
export async function browserTabLogin({ url, domain, required, wanted = required, origin, afterwards }) {
  if (current) throw new HttpError(409, 'A login is already in progress. Finish there, or cancel it first.');
  const setup = (name) =>
    new HttpError(409, `Could not reach ${name}. Open chrome://inspect/#remote-debugging in it, tick "Allow remote debugging for this browser instance", then try again and choose Allow when it asks.`);
  const browser = installedBrowsers().find((b) => readDebuggerUrl(b.userData));
  if (!browser) throw setup('your browser');

  const state = (current = { cancelled: false });
  let cdp = null;
  let tab = null;
  let self = null;
  let lingering = false;
  try {
    // The socket stays pending while the browser shows its "Allow remote debugging?" prompt.
    const connecting = connectCdp(readDebuggerUrl(browser.userData));
    connecting.then((socket) => current !== state && socket.close(), () => {});
    cdp = await Promise.race([
      connecting.catch(() => Promise.reject(setup(browser.name))),
      new Promise((_, reject) => {
        state.onCancel = () => reject(new HttpError(400, 'Login cancelled.'));
        setTimeout(() => reject(new HttpError(408, `Timed out waiting for ${browser.name} to allow the connection.`)), TIMEOUT_MS).unref();
      }),
    ]);

    const pages = async () => (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
    self = (origin && (await pages()).find((t) => t.url.startsWith(origin))) || null;
    const context = self?.browserContextId ? { browserContextId: self.browserContextId } : {};
    const withContext = (method, params = {}) => cdp.send(method, { ...params, ...context }).catch(() => cdp.send(method, params));
    const read = async () => cookieJar((await withContext('Storage.getCookies')).cookies, domain, wanted);

    let jar = await read();
    if (!required.every((name) => jar[name])) {
      tab = (await withContext('Target.createTarget', { url })).targetId;
      jar = await waitForCookies({
        read,
        required,
        state,
        gone: async () => {
          if (cdp.closed) return `${browser.name} was closed before you finished logging in.`;
          return !(await pages()).some((t) => t.targetId === tab) && 'The login tab was closed before you finished logging in.';
        },
      });
    }
    const { userAgent } = await cdp.send('Browser.getVersion').catch(() => ({}));
    if (afterwards) {
      lingering = true;
      const browser = cdp;
      (async () => {
        const { targetId } = await withContext('Target.createTarget', { url: 'about:blank', background: true });
        try {
          const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
          await afterwards(async (pageUrl, expression) => {
            await browser.send('Page.navigate', { url: pageUrl }, sessionId);
            await sleep(8000); // the page loads its code in stages
            return (await browser.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result?.value;
          });
        } finally {
          await browser.send('Target.closeTarget', { targetId }).catch(() => {});
        }
      })()
        .catch(() => {})
        .finally(() => browser.close());
    }
    return { cookies: jar, userAgent };
  } finally {
    current = null;
    if (tab) {
      await cdp.send('Target.closeTarget', { targetId: tab }).catch(() => {});
      if (self) await cdp.send('Target.activateTarget', { targetId: self.targetId }).catch(() => {});
    }
    if (!lingering) cdp?.close();
  }
}

export function cancelBrowserLogin() {
  if (!current) return false;
  current.cancelled = true;
  current.onCancel?.();
  return true;
}
