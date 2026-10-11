import { browserLogin, browserTabLogin, forgetLoginProfile } from '../browserLogin.js';
import { getKV, setKV } from '../db.js';
import { broadcast } from '../events.js';
import { resumeJobs } from '../jobs.js';
import { HttpError } from '../util.js';
import { RedditClient, parseCookies } from './client.js';
import { MockRedditClient } from './mock.js';
import { archiveSummary, clearOwner } from './store.js';

export const rd = { api: null, me: null, demo: false };
const LOGIN_PROFILE = 'reddit';
const LOGIN = { url: 'https://www.reddit.com/login/', domain: 'reddit.com', required: ['reddit_session'] };

export function requireRd() {
  if (!rd.api) throw new HttpError(401, 'No Reddit account connected.');
  return rd;
}

export function rdState() {
  if (!rd.api) return { connected: false };
  const { total, comments, posts, deleted } = archiveSummary(rd.me.name);
  return { connected: true, demo: rd.demo, user: rd.me, archive: { total, comments, posts, deleted } };
}

const announce = () => broadcast('session', { platform: 'reddit' });

function attach(api, me, demo) {
  Object.assign(rd, { api, me, demo });
  announce();
  resumeJobs();
}

async function establish(api, demo) {
  attach(api, await api.me(), demo);
  return rdState();
}

export async function connectRd(input, remember, userAgent) {
  const cookies = typeof input === 'object' ? input : parseCookies(input);
  if (!cookies.reddit_session) throw new HttpError(400, 'Paste your reddit_session cookie to connect.');
  try {
    const state = await establish(new RedditClient(cookies, userAgent), false);
    setKV('reddit.cookies', remember ? cookies : null);
    setKV('reddit.ua', remember && userAgent ? userAgent : null);
    setKV('reddit.me', remember ? rd.me : null);
    return state;
  } catch (err) {
    if (err.expired) throw new HttpError(401, 'Reddit did not accept that session. Log in to reddit.com first, then try again.');
    throw new HttpError(err.blocked ? 429 : 502, err.message);
  }
}

/** From the browser the user already has open: reads the session if they are logged in, else opens the login page in a new tab. */
export async function loginRdInBrowserTab({ remember, origin } = {}) {
  const { cookies, userAgent } = await browserTabLogin({ ...LOGIN, origin });
  return connectRd(cookies, remember, userAgent);
}

/** In a separate window with its own profile. */
export async function loginRdWithBrowser({ remember } = {}) {
  const { cookies, userAgent } = await browserLogin({ ...LOGIN, profile: LOGIN_PROFILE, keepProfile: remember });
  return connectRd(cookies, remember, userAgent);
}

export const connectRdDemo = () => establish(new MockRedditClient(), true);

export function disconnectRd() {
  if (rd.demo) clearOwner(rd.me.name);
  else {
    for (const key of ['reddit.cookies', 'reddit.ua', 'reddit.me']) setKV(key, null);
    forgetLoginProfile(LOGIN_PROFILE);
  }
  Object.assign(rd, { api: null, me: null, demo: false });
  announce();
}

export async function restoreRd() {
  clearOwner('demo_redditor'); // in case the app was closed mid-demo
  const cookies = getKV('reddit.cookies');
  if (!cookies) return;
  const api = new RedditClient(cookies, getKV('reddit.ua'));
  // Trust the saved session straight away so a restart never waits on Reddit; only Reddit saying it is over ends it.
  const me = getKV('reddit.me');
  if (me) {
    api.username = me.name;
    attach(api, me, false);
  }
  const check = async () => {
    if (rd.api && rd.api !== api) return;
    try {
      await establish(api, false);
      setKV('reddit.me', rd.me);
    } catch (err) {
      console.warn(`Could not check the saved Reddit session: ${err.message}`);
      if (!err.expired) return void setTimeout(check, 60000).unref();
      if (rd.api === api) {
        Object.assign(rd, { api: null, me: null, demo: false });
        announce();
      }
    }
  };
  if (me) check();
  else await check();
}
