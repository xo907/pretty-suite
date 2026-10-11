import { browserLogin, browserTabLogin, forgetLoginProfile } from '../browserLogin.js';
import { browserUserData } from '../browserProfiles.js';
import { getKV, setKV } from '../db.js';
import { broadcast } from '../events.js';
import { resumeJobs } from '../jobs.js';
import { HttpError, sleep } from '../util.js';
import { DOC_IDS, IgClient, parseCookies } from './client.js';
import { MockIgClient } from './mock.js';
import { clearDemo, lastSynced, relationshipCounts, saveUser } from './store.js';

export const ig = { api: null, me: null, demo: false };

export function requireIg() {
  if (!ig.api) throw new HttpError(401, 'No Instagram account connected.');
  return ig;
}

export function igState() {
  if (!ig.api) return { connected: false };
  return {
    connected: true,
    demo: ig.demo,
    user: ig.me,
    synced: lastSynced(ig.me.pk) || null,
    counts: relationshipCounts(ig.me.pk),
  };
}

const announce = () => broadcast('session', { platform: 'instagram' });

function attach(api, me, demo) {
  Object.assign(ig, { api, me, demo });
  if (!demo) api.onCookies = persistCookies;
  announce();
  resumeJobs();
}

async function establish(api, demo) {
  const basic = await api.me();
  // The profile call adds follower / following / post counts for the overview.
  // Optional, so it must not hold the connection up while the client waits out a rate limit.
  const me = await api.profile(basic.username, AbortSignal.timeout(8000), basic.pk).catch(() => basic);
  saveUser(me);
  attach(api, { ...basic, ...me }, demo);
  return igState();
}

const LOGIN_PROFILE = 'instagram';

/**
 * Opens Instagram in a separate browser window and connects once a session is present.
 * With `source` ({ browser, profileDir }) the window is seeded from the user's own browser profile,
 * so if they are already logged in on it nothing more is needed; otherwise they log in in the window.
 */
export async function loginIgWithBrowser({ remember, source } = {}) {
  const seed = source?.browser && { browser: source.browser, name: source.name, userData: browserUserData(source.browser), profileDir: source.profileDir || 'Default' };
  if (source?.browser && !seed.userData) throw new HttpError(400, 'That browser is not installed on this computer.');
  const { cookies, userAgent } = await browserLogin({
    profile: LOGIN_PROFILE,
    url: seed ? 'https://www.instagram.com/' : 'https://www.instagram.com/accounts/login/',
    domain: 'instagram.com',
    required: ['sessionid'],
    wanted: ['sessionid', 'csrftoken', 'ds_user_id'],
    keepProfile: remember,
    source: seed,
  });
  return connectIg(cookies, remember, userAgent);
}

/**
 * instagram.com names its data operations by ids that change as the site is updated. While the browser connection
 * from login is still open, read the ids it is using today so the client keeps working after such an update.
 */
async function learnDocIds(visit) {
  for (let i = 0; i < 40 && !ig.me; i++) await sleep(500);
  if (!ig.me || ig.demo) return;
  const expression = `(() => {
    const out = {};
    for (const name of ${JSON.stringify(Object.keys(DOC_IDS))}) {
      try {
        const id = require(name + '_instagramRelayOperation');
        if (typeof id === 'string') out[name] = id;
      } catch (err) {}
    }
    return out;
  })()`;
  const found = {};
  for (const page of [`${ig.me.username}/`, 'direct/inbox/']) Object.assign(found, await visit(`https://www.instagram.com/${page}`, expression));
  if (!Object.keys(found).length) return;
  setKV('instagram.docIds', { ...getKV('instagram.docIds', {}), ...found });
  if (ig.api?.docIds) Object.assign(ig.api.docIds, found);
}

/** Connects from the browser the user already has open, opening Instagram in a new tab there only if they still need to log in. */
export async function loginIgInBrowserTab({ remember, origin } = {}) {
  const { cookies, userAgent } = await browserTabLogin({
    url: 'https://www.instagram.com/accounts/login/',
    domain: 'instagram.com',
    required: ['sessionid'],
    wanted: ['sessionid', 'csrftoken', 'ds_user_id'],
    origin,
    afterwards: learnDocIds,
  });
  return connectIg(cookies, remember, userAgent);
}

export async function connectIg(input, remember, userAgent) {
  const cookies = typeof input === 'object' ? input : parseCookies(input);
  if (!cookies.sessionid) throw new HttpError(400, 'Paste your Instagram sessionid cookie to connect.');
  const api = new IgClient(cookies, userAgent);
  try {
    const state = await establish(api, false);
    setKV('instagram.cookies', remember ? api.cookies : null);
    setKV('instagram.ua', remember && userAgent ? userAgent : null);
    setKV('instagram.me', remember ? ig.me : null);
    return state;
  } catch (err) {
    if (err.expired) throw new HttpError(401, 'Instagram rejected that session cookie. Copy a fresh one while logged in and try again.');
    throw new HttpError(err.blocked ? 429 : 502, err.message);
  }
}

export const connectIgDemo = () => establish(new MockIgClient(), true);

export function disconnectIg() {
  if (ig.demo) clearDemo();
  else {
    setKV('instagram.cookies', null);
    setKV('instagram.ua', null);
    setKV('instagram.me', null);
    forgetLoginProfile(LOGIN_PROFILE);
  }
  Object.assign(ig, { api: null, me: null, demo: false });
  announce();
}

export async function restoreIg() {
  clearDemo();
  const cookies = getKV('instagram.cookies');
  if (!cookies) return;
  const api = new IgClient(cookies, getKV('instagram.ua'));
  // The saved session is trusted as it stands, so a restart never depends on Instagram answering right then
  // (it rate-limits freely). The check below runs afterwards and only ends the session if Instagram says it is over.
  const me = getKV('instagram.me');
  if (me) attach(api, me, false);
  const check = async () => {
    if (ig.api && ig.api !== api) return; // connected some other way in the meantime
    try {
      await establish(api, false);
      setKV('instagram.me', ig.me);
    } catch (err) {
      console.warn(`Could not check the saved Instagram session: ${err.message}`);
      if (!err.expired) return void setTimeout(check, 60000).unref();
      if (ig.api === api) {
        Object.assign(ig, { api: null, me: null, demo: false });
        announce();
      }
    }
  };
  if (me) check();
  else await check();
}

/** Keep the rotated CSRF token so the saved session keeps working across restarts. */
export function persistCookies() {
  if (ig.api && !ig.demo && getKV('instagram.cookies')) setKV('instagram.cookies', ig.api.cookies);
}
