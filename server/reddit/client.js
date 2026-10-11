// Reddit client. Uses the same JSON endpoints old.reddit.com serves its own pages from, authenticated with the
// browser's session cookie, and returns small normalised objects so the engines never see raw payloads.
import { sleep } from '../util.js';

const BASE = 'https://old.reddit.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class RedditError extends Error {
  constructor(message, { status, expired = false, blocked = false } = {}) {
    super(message);
    this.name = 'RedditError';
    this.status = status;
    this.expired = expired;
    this.blocked = blocked; // Reddit is refusing this client altogether
    this.stop = expired || blocked; // not about one item: the next one would fail the same way
  }
}

/** Accepts a bare reddit_session value or a whole Cookie header. */
export function parseCookies(input) {
  const text = String(input || '').trim().replace(/^cookie:\s*/i, '');
  if (!/reddit_session\s*=/.test(text)) return text ? { reddit_session: text.replace(/^"|"$/g, '') } : {};
  const jar = {};
  for (const part of text.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'reddit_session') jar[name] = rest.join('=');
  }
  return jar;
}

/** One comment or post, whichever listing it came from. */
const thing = ({ kind, data: d }) => ({
  name: d.name, // "t1_…" for a comment, "t3_…" for a post
  kind: kind === 't1' ? 'comment' : 'post',
  subreddit: d.subreddit,
  title: d.title ?? d.link_title ?? '',
  body: d.body ?? d.selftext ?? '',
  url: kind === 't3' && !d.is_self ? d.url : null,
  isSelf: kind === 't1' || Boolean(d.is_self),
  permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
  score: d.score ?? 0,
  ts: (d.created_utc || 0) * 1000,
  author: d.author,
  archived: Boolean(d.archived),
});

export class RedditClient {
  constructor(cookies, userAgent) {
    this.cookies = { ...cookies };
    this.userAgent = userAgent || USER_AGENT;
    this.modhash = null;
    this.username = null;
  }

  async request(method, path, { query, form, signal } = {}) {
    const url = new URL(BASE + path);
    url.searchParams.set('raw_json', '1');
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        signal,
        redirect: 'manual',
        headers: {
          Cookie: Object.entries(this.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; '),
          'User-Agent': this.userAgent,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${BASE}/`,
          ...(method === 'POST' ? { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: method === 'POST' ? new URLSearchParams({ api_type: 'json', ...form, uh: this.modhash || '' }).toString() : undefined,
      });
      // Reddit says how much of the current allowance is left; slow down before it runs out rather than after.
      const remaining = Number(res.headers.get('x-ratelimit-remaining'));
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (res.status === 429) {
        if (attempt >= 3) throw new RedditError('Reddit keeps saying to slow down. Stopped for now — try again in a while.', { status: 429, blocked: true });
        await sleep(((reset || 30 * (attempt + 1)) + 2) * 1000, signal);
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        if (/login|register/.test(res.headers.get('location') || '')) throw new RedditError('Your Reddit session has expired. Reconnect to continue.', { status: 401, expired: true });
        throw new RedditError(`Reddit redirected ${method} ${path} somewhere unexpected.`, { status: res.status });
      }
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // Not JSON: an error page.
      }
      if (res.status === 401 || (res.status === 403 && /USER_REQUIRED|please log in/i.test(text))) {
        throw new RedditError('Your Reddit session has expired. Reconnect to continue.', { status: 401, expired: true });
      }
      if (res.status === 403 && !data) {
        throw new RedditError('Reddit refused the request outright (it blocks some networks and VPNs). Nothing was changed.', { status: 403, blocked: true });
      }
      const problem = data?.json?.errors?.[0];
      if (problem) {
        if (problem[0] === 'USER_REQUIRED') throw new RedditError('Your Reddit session has expired. Reconnect to continue.', { status: 401, expired: true });
        throw new RedditError(problem[1] || problem[0], { status: 400 });
      }
      if (!res.ok || !data) throw new RedditError(data?.message || `Reddit responded with HTTP ${res.status} (${method} ${path})`, { status: res.status });
      if (res.ok && remaining < 3 && reset) await sleep((reset + 1) * 1000, signal);
      return data;
    }
  }

  async me() {
    const { data } = await this.request('GET', '/api/me.json');
    if (!data?.name) throw new RedditError('Reddit did not accept that session. Log in again.', { status: 401, expired: true });
    this.modhash = data.modhash;
    this.username = data.name;
    return {
      id: data.id,
      name: data.name,
      icon: data.icon_img ? data.icon_img.split('?')[0] : null,
      postKarma: data.link_karma ?? 0,
      commentKarma: data.comment_karma ?? 0,
      created: (data.created_utc || 0) * 1000,
    };
  }

  /** `which`: comments, submitted, saved, upvoted, downvoted or hidden. Up to 100 per page. */
  async listing(which, { after, sort = 'new' } = {}, signal) {
    if (!this.username) await this.me();
    const { data } = await this.request('GET', `/user/${this.username}/${which}.json`, { query: { limit: 100, sort, after }, signal });
    return { items: (data?.children || []).filter((c) => c.kind === 't1' || c.kind === 't3').map(thing), next: data?.after || null };
  }

  async #act(path, form, signal) {
    if (!this.modhash) await this.me();
    return this.request('POST', path, { form, signal });
  }
  edit = (name, text, signal) => this.#act('/api/editusertext', { thing_id: name, text }, signal);
  remove = (name, signal) => this.#act('/api/del', { id: name }, signal);
  unsave = (name, signal) => this.#act('/api/unsave', { id: name }, signal);
  unvote = (name, signal) => this.#act('/api/vote', { id: name, dir: 0 }, signal);
  unhide = (name, signal) => this.#act('/api/unhide', { id: name }, signal);

  async communities(after, signal) {
    const { data } = await this.request('GET', '/subreddits/mine/subscriber.json', { query: { limit: 100, after }, signal });
    return {
      items: (data?.children || []).map(({ data: s }) => ({
        name: s.name, // "t5_…"
        title: s.display_name,
        about: s.title || '',
        members: s.subscribers ?? 0,
        icon: (s.community_icon || s.icon_img || '').split('?')[0] || null,
        isUser: s.display_name?.startsWith('u_') || false,
      })),
      next: data?.after || null,
    };
  }
  leave = (name, signal) => this.#act('/api/subscribe', { action: 'unsub', sr: name }, signal);
}
