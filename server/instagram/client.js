// Instagram web client. Speaks the same private endpoints instagram.com uses, authenticated with the
// browser session cookie, and returns small normalised objects so the engines never see raw payloads.
import { randomUUID } from 'node:crypto';
import { getKV } from '../db.js';
import { sleep } from '../util.js';

const BASE = 'https://www.instagram.com';
const APP_ID = '936619743392459'; // the public web app id instagram.com sends
const ASBD_ID = '359341'; // likewise sent with every instagram.com API call
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// instagram.com now loads profiles, posts and messages through GraphQL operations it names by id. These are the
// ids the site was using when they were captured; newer ones read from the browser at login (KV "instagram.docIds") win.
export const DOC_IDS = {
  PolarisProfilePageContentQuery: '28036671149327607',
  PolarisProfilePostsQuery: '28542612348729311',
  PolarisProfilePostsTabContentQuery_connection: '28142289515441884',
  PolarisDirectInboxQuery: '27909866362025854',
  IGDThreadListOffMsysPaginationQuery: '28774058922187457',
  IGDThreadDetailQuery: '29613940454875963',
  IGDMessageListOffMsysQuery: '28798548116496168',
  IGDMessageUnsendDialogOffMsysMutation: '26948700068153789',
  IGDInboxInfoDeleteThreadDialogOffMsysMutation: '35352443081068612',
  PolarisCommentActionsDeleteMutation: '28973546118903529',
  PolarisAPIUnlikePostMutation: '27259125457096864',
  PolarisAPILikePostMutation: '28051398997871885',
  usePolarisFollowMutation: '26508036048874888',
  usePolarisUnfollowMutation: '27789106940691111',
};
// The fixed part of each operation's variables, as the site sends them.
const VARS = {
  profile: {
    enable_integrity_filters: true,
    __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
    __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
    __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: true,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
  },
  posts: {
    data: { count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true, latest_besties_reel_media: true, latest_reel_media: true },
    __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
  },
  inbox: {
    __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
    __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
    __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
    __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true,
  },
  thread: { __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: false },
};
const MESSAGES_PER_PAGE = 100;
const DEFAULT_AVATAR = '44884218_345707102882519'; // filename fragment of Instagram's blank profile picture

export class IgError extends Error {
  constructor(message, { status, blocked = false, expired = false, gone = false } = {}) {
    super(message);
    this.name = 'IgError';
    this.status = status;
    this.blocked = blocked; // Instagram is pushing back: stop everything
    this.expired = expired;
    this.gone = gone; // the website no longer offers this at all
    this.stop = blocked || expired || gone; // not about one item: carrying on with the next would fail the same way
  }
}

const expiredError = () => new IgError('Your Instagram session has expired. Reconnect to continue.', { status: 401, expired: true });
const goneError = (what) =>
  new IgError(`Instagram's website no longer offers this (${what}), so it does not work in Pretty Suite for now. Your session is fine.`, { status: 410, gone: true });
const LIMITED = 'Instagram is limiting this account right now (it asked for a check or blocked the action). Stopped immediately to protect your account — wait a day before trying again.';

/** Accepts a bare sessionid value or a whole Cookie header and returns the cookies we need. */
export function parseCookies(input) {
  const text = String(input || '').trim().replace(/^cookie:\s*/i, '');
  const jar = {};
  if (/sessionid\s*=/.test(text)) {
    for (const part of text.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (['sessionid', 'csrftoken', 'ds_user_id'].includes(name)) jar[name] = rest.join('=');
    }
  } else if (text) {
    jar.sessionid = text.replace(/^"|"$/g, '');
  }
  return jar;
}

const basicUser = (u) => ({
  pk: String(u.pk ?? u.id),
  username: u.username,
  fullName: u.full_name || '',
  pic: u.profile_pic_url || null,
  isPrivate: Boolean(u.is_private),
  isVerified: Boolean(u.is_verified),
  noPic: Boolean(u.has_anonymous_profile_picture) || u.has_profile_pic === false || String(u.profile_pic_url || '').includes(DEFAULT_AVATAR),
});

const post = (m) => ({
  id: String(m.pk ?? String(m.id).split('_')[0]),
  code: m.code,
  ts: (m.taken_at || 0) * 1000,
  caption: m.caption?.text || '',
  likes: m.like_count ?? 0,
  comments: m.comment_count ?? 0,
  liked: Boolean(m.has_liked),
  thumb: (m.image_versions2 || m.carousel_media?.[0]?.image_versions2)?.candidates?.at(-1)?.url || null,
  owner: m.user ? basicUser(m.user) : null,
});

/** Collects every `media.user` found anywhere in a hashtag payload, whose layout changes often. */
function usersInTree(node, found = new Map()) {
  if (!node || typeof node !== 'object') return found;
  if (node.user?.pk && node.user.username && (node.taken_at || node.code)) found.set(String(node.user.pk), basicUser(node.user));
  for (const value of Object.values(node)) usersInTree(value, found);
  return found;
}

export class IgClient {
  /** `userAgent` should be the browser the session was created in, so requests stay consistent with it. */
  constructor(cookies, userAgent) {
    this.userAgent = userAgent || USER_AGENT;
    this.cookies = { ...cookies };
    if (!this.cookies.ds_user_id) this.cookies.ds_user_id = decodeURIComponent(this.cookies.sessionid || '').split(':')[0];
    this.docIds = { ...DOC_IDS, ...getKV('instagram.docIds', {}) };
    this.deviceId = randomUUID();
    this.threadNodes = new Map();
    this.threadIds = new Map(); // a conversation has two ids; unsending wants the long one
  }

  #cookie() {
    return Object.entries(this.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** The two tokens the site embeds in every page and expects back with each GraphQL call. */
  async #tokens(signal, fresh) {
    if (!fresh && this.tokens && Date.now() - this.tokens.at < 30 * 60 * 1000) return this.tokens;
    const res = await fetch(`${BASE}/`, {
      signal,
      redirect: 'manual',
      headers: {
        Cookie: this.#cookie(),
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    });
    const html = await res.text();
    const dtsg = /DTSGInitialData",\[\],\{"token":"([^"]+)/.exec(html)?.[1];
    const lsd = /"LSD",\[\],\{"token":"([^"]+)/.exec(html)?.[1];
    if (!dtsg || !lsd) {
      if (res.status >= 300 && res.status < 400 && /login|challenge/.test(res.headers.get('location') || '')) throw expiredError();
      throw new IgError(`Could not read Instagram's page tokens (HTTP ${res.status}).`, { status: 502 });
    }
    return (this.tokens = { dtsg, lsd, at: Date.now() });
  }

  /** Runs one of the site's GraphQL operations and returns its `data`. */
  async gql(name, variables, signal) {
    for (let attempt = 0; ; attempt++) {
      const { dtsg, lsd } = await this.#tokens(signal, attempt > 0);
      const res = await fetch(`${BASE}/api/graphql`, {
        method: 'POST',
        signal,
        redirect: 'manual',
        headers: {
          Cookie: this.#cookie(),
          'User-Agent': this.userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-FB-Friendly-Name': name,
          'X-FB-LSD': lsd,
          'X-CSRFToken': this.cookies.csrftoken || 'missing',
          'X-IG-App-ID': APP_ID,
          'X-ASBD-ID': ASBD_ID,
          Accept: '*/*',
          Origin: BASE,
          Referer: `${BASE}/`,
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: new URLSearchParams({
          av: this.cookies.ds_user_id,
          __d: 'www',
          __user: '0',
          __a: '1',
          __comet_req: '7',
          fb_dtsg: dtsg,
          lsd,
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: name,
          variables: JSON.stringify(variables),
          server_timestamps: 'true',
          doc_id: this.docIds[name],
        }).toString(),
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text.replace(/^for \(;;\);/, '').split('\n')[0]);
      } catch {
        // Not JSON.
      }
      if (res.status === 429 || /feedback_required|checkpoint_required|challenge_required/.test(text.slice(0, 600))) {
        throw new IgError(LIMITED, { status: res.status, blocked: true });
      }
      // Individual fields can fail while the rest of the answer is fine, so errors only matter when nothing came back.
      if (body?.data && Object.values(body.data).some((value) => value !== null)) return body.data;
      const code = body?.error ?? body?.errors?.[0]?.code;
      if (code === 1357004 && attempt === 0) continue; // tokens went stale: read fresh ones and ask again
      if (code === 1357001 || res.status === 401) throw expiredError();
      const detail = body?.errors?.[0]?.message || body?.errorSummary || (body ? 'an empty answer' : `HTTP ${res.status}`);
      throw new IgError(`Instagram could not answer ${name}: ${detail}`, { status: res.status === 200 ? 502 : res.status });
    }
  }

  async request(method, path, { query, form, signal } = {}) {
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        signal,
        redirect: 'manual',
        headers: {
          Cookie: this.#cookie(),
          'User-Agent': this.userAgent,
          'X-IG-App-ID': APP_ID,
          'X-CSRFToken': this.cookies.csrftoken || 'missing',
          'X-Requested-With': 'XMLHttpRequest',
          'X-ASBD-ID': ASBD_ID,
          Accept: '*/*',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          Referer: `${BASE}/`,
          ...(method === 'POST' ? { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: method === 'POST' ? new URLSearchParams(form || {}).toString() : undefined,
      });
      // Instagram rotates the CSRF token through Set-Cookie; keep ours in step.
      for (const cookie of res.headers.getSetCookie?.() || []) {
        const match = cookie.match(/^csrftoken=([^;]+)/);
        if (match && match[1] !== this.cookies.csrftoken) {
          this.cookies.csrftoken = match[1];
          this.onCookies?.();
        }
      }
      // Only a redirect to the login or checkpoint pages means the session is over. A redirect anywhere else (or a
      // "page not found") is the site saying this address has been retired.
      if (res.status >= 300 && res.status < 400) {
        if (/\/accounts\/login|\/challenge|\/accounts\/suspended/.test(res.headers.get('location') || '')) throw expiredError();
        throw goneError(`${method} ${path}`);
      }
      if (res.status === 429 && attempt < 2) {
        await sleep(60000 * (attempt + 1), signal);
        continue;
      }
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text.replace(/^for (;;);/, ''));
      } catch {
        // Not JSON: Instagram answered with a page instead of the API.
      }
      const reason = data?.message || '';
      if (/feedback_required|checkpoint_required|challenge_required/.test(reason) || data?.spam || res.status === 429) {
        throw new IgError(LIMITED, { status: res.status, blocked: true });
      }
      if (res.status === 401 || /login_required/.test(reason)) throw expiredError();
      if ((res.status === 404 && !data) || /useragent mismatch/.test(reason)) throw goneError(`${method} ${path}`);
      if (!res.ok || !data) {
        const page = data ? '' : ` and ${/<title>([^<]*)/i.exec(text)?.[1]?.trim() ? `the page "${/<title>([^<]*)/i.exec(text)[1].trim()}"` : text.trim() ? `"${text.trim().slice(0, 80)}"` : 'an empty body'} instead of data`;
        throw new IgError(reason || `Instagram responded with HTTP ${res.status}${page} (${method} ${path})`, { status: res.status });
      }
      return data;
    }
  }

  // ── Account & people ────────────────────────────────────────────────────────────────────────────
  async me() {
    // The web session is not accepted by accounts/current_user (it redirects home); the edit form is.
    const { form_data: form } = await this.request('GET', '/api/v1/accounts/edit/web_form_data/');
    this.username = form.username;
    return basicUser({ pk: this.cookies.ds_user_id, username: form.username, full_name: [form.first_name, form.last_name].filter(Boolean).join(' ') });
  }

  /** `pk` saves a lookup when the caller already knows it. */
  async profile(username, signal, pk) {
    pk ??= (await this.searchUsers(username, signal)).find((u) => u.username.toLowerCase() === username.toLowerCase())?.pk;
    const u = pk && (await this.gql('PolarisProfilePageContentQuery', { ...VARS.profile, id: pk }, signal)).user;
    if (!u) throw new IgError(`@${username} was not found.`, { status: 404 });
    // The profile itself no longer says when the account last posted; its newest posts do (pinned ones come first).
    let lastPostTs = null;
    if (u.media_count) {
      const latest = await this.#timeline(u.username, null, signal).catch((err) => {
        if (err.stop || err.name !== 'IgError') throw err;
        return null; // private, or nothing visible to us
      });
      if (latest?.items.length) lastPostTs = Math.max(...latest.items.map((p) => p.ts));
    }
    return {
      ...basicUser(u),
      followers: u.follower_count ?? 0,
      following: u.following_count ?? 0,
      posts: u.media_count ?? 0,
      bio: u.biography || '',
      lastPostTs,
    };
  }

  async #timeline(username, cursor, signal) {
    const data = await this.gql(
      cursor ? 'PolarisProfilePostsTabContentQuery_connection' : 'PolarisProfilePostsQuery',
      { ...VARS.posts, username, ...(cursor ? { after: cursor, before: null, first: 12, last: null } : {}) },
      signal
    );
    const list = data.xdt_api__v1__feed__user_timeline_graphql_connection;
    return { items: (list?.edges || []).map((edge) => post(edge.node)), next: list?.page_info?.has_next_page ? list.page_info.end_cursor : null };
  }

  async #people(path, cursor, signal) {
    const data = await this.request('GET', path, { query: { count: 50, max_id: cursor }, signal });
    return { items: (data.users || []).map(basicUser), next: data.next_max_id ? String(data.next_max_id) : null };
  }
  followers = (pk, cursor, signal) => this.#people(`/api/v1/friendships/${pk}/followers/`, cursor, signal);
  following = (pk, cursor, signal) => this.#people(`/api/v1/friendships/${pk}/following/`, cursor, signal);

  // Following goes through the operation the site's own Follow button uses; the older address for it now errors.
  follow = (pk, signal) => this.gql('usePolarisFollowMutation', { target_user_id: pk, container_module: 'profile', nav_chain: '' }, signal);
  /** The older address still works for unfollowing; if Instagram retires it too, use the site's current operation. */
  async unfollow(pk, signal) {
    try {
      return await this.request('POST', `/api/v1/web/friendships/${pk}/unfollow/`, { form: { container_module: 'profile', user_id: pk }, signal });
    } catch (err) {
      if (!err.gone) throw err;
      return this.gql('usePolarisUnfollowMutation', { target_user_id: pk, container_module: 'profile', nav_chain: '' }, signal);
    }
  }

  async searchUsers(keyword, signal) {
    const data = await this.request('GET', '/api/v1/web/search/topsearch/', { query: { context: 'user', query: keyword }, signal });
    return (data.users || []).map((entry) => basicUser(entry.user || entry));
  }

  async hashtagUsers(tag, signal) {
    const data = await this.request('GET', '/api/v1/tags/web_info/', { query: { tag_name: tag.replace(/^#/, '') }, signal });
    return [...usersInTree(data).values()];
  }

  async similar(pk, signal) {
    const data = await this.request('GET', '/api/v1/discover/chaining/', { query: { target_id: pk }, signal });
    return (data.users || []).map(basicUser);
  }

  // ── Direct messages ─────────────────────────────────────────────────────────────────────────────
  async inbox(cursor, signal) {
    const data = cursor
      ? await this.gql('IGDThreadListOffMsysPaginationQuery', { ...VARS.inbox, after: cursor, first: 20, id: this.mailboxId }, signal)
      : await this.gql('PolarisDirectInboxQuery', { ...VARS.inbox, device_id_for_iris_subscription: this.deviceId }, signal);
    const box = data.get_slide_mailbox_for_iris_subscription ?? data.node;
    if (box?.id) this.mailboxId = box.id;
    const list = box?.threads_by_folder;
    return {
      items: (list?.edges || [])
        .map((edge) => edge.node?.as_ig_direct_thread)
        .filter(Boolean)
        .map((t) => {
          this.threadIds.set(t.thread_fbid, t.thread_id);
          const last = t.slide_messages?.edges?.at(-1)?.node;
          return {
            id: t.thread_fbid,
            title: t.thread_title || (t.users || []).map((u) => u.username).join(', '),
            users: (t.users || []).map((u) => basicUser({ ...u, pk: u.id })),
            lastTs: Number(t.last_activity_timestamp_ms) || 0,
            lastText: last?.text_body || (last ? `[${String(last.content_type).replace(/^MESSAGE_/, '').toLowerCase().replace(/_/g, ' ')}]` : ''),
          };
        }),
      next: list?.page_info?.has_next_page ? list.page_info.end_cursor : null,
    };
  }

  /** Newest messages first time round; `cursor` then walks back through older ones. */
  async threadItems(threadId, cursor, signal) {
    const data = cursor
      ? await this.gql('IGDMessageListOffMsysQuery', { ...VARS.thread, before: cursor, last: MESSAGES_PER_PAGE, id: this.threadNodes.get(threadId) }, signal)
      : await this.gql('IGDThreadDetailQuery', { ...VARS.thread, min_uq_seq_id: null, thread_fbid: threadId, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: MESSAGES_PER_PAGE }, signal);
    const node = data.get_slide_thread_nullable ?? data.node;
    if (node?.id) this.threadNodes.set(threadId, node.id);
    const thread = node?.as_ig_direct_thread ?? node;
    if (thread?.thread_id) this.threadIds.set(threadId, thread.thread_id);
    const messages = thread?.slide_messages;
    if (!messages) throw new IgError('That conversation could not be opened.', { status: 404 });
    return {
      items: messages.edges.map(({ node: m }) => ({ id: m.message_id, userId: String(m.sender?.igid ?? ''), ts: Number(m.timestamp_ms) || 0, type: m.content_type, text: m.text_body || '' })),
      next: messages.page_info?.has_previous_page ? messages.page_info.start_cursor : null,
    };
  }

  async unsend(threadId, itemId, signal) {
    if (!this.threadIds.has(threadId)) await this.threadItems(threadId, null, signal);
    return this.gql('IGDMessageUnsendDialogOffMsysMutation', { message_id: itemId, send_data: { thread_id: this.threadIds.get(threadId) } }, signal);
  }
  hideThread = (threadId, signal) =>
    this.gql('IGDInboxInfoDeleteThreadDialogOffMsysMutation', { thread_fbid: threadId, should_move_future_requests_to_spam: false }, signal);

  // ── Posts, comments, likes ──────────────────────────────────────────────────────────────────────
  async myPosts(cursor, signal) {
    this.username ??= (await this.me()).username;
    return this.#timeline(this.username, cursor, signal);
  }
  /** Anyone's posts, newest page first (pinned ones lead). */
  userPosts = (username, cursor, signal) => this.#timeline(username, cursor, signal);
  like = (id, signal) => this.gql('PolarisAPILikePostMutation', { input: { media_id: id } }, signal);
  // The website has no list of liked posts any more (only the app does), so there is nothing to ask.
  liked = async () => {
    throw goneError('the list of posts you liked');
  };

  deletePost = (id, signal) => this.request('POST', `/api/v1/web/create/${id}/delete/`, { signal });
  archivePost = (id, signal) => this.request('POST', `/api/v1/media/${id}/only_me/`, { form: { media_id: id }, signal });
  unlike = (id, signal) => this.gql('PolarisAPIUnlikePostMutation', { input: { media_id: id } }, signal);

  async comments(mediaId, cursor, signal) {
    const data = await this.request('GET', `/api/v1/media/${mediaId}/comments/`, { query: { can_support_threading: true, min_id: cursor }, signal });
    return {
      items: (data.comments || []).map((c) => ({
        id: String(c.pk),
        userId: String(c.user_id ?? c.user?.pk),
        username: c.user?.username || '',
        pic: c.user?.profile_pic_url || null,
        text: c.text || '',
        ts: (c.created_at || 0) * 1000,
      })),
      next: data.next_min_id || null,
    };
  }

  deleteComment = (mediaId, commentId, signal) => this.gql('PolarisCommentActionsDeleteMutation', { input: { comment_id: commentId, media_id: mediaId } }, signal);
}
