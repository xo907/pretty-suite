import { defineJob, startJob } from '../jobs.js';
import { HttpError } from '../util.js';
import * as engines from './engines.js';
import { autopilotSettings, prepareAutopilot, runAutopilot } from './autopilot.js';
import { cancelBrowserLogin } from '../browserLogin.js';
import { detectBrowsers } from '../browserProfiles.js';
import { connectIg, connectIgDemo, disconnectIg, ig, igState, loginIgInBrowserTab, loginIgWithBrowser, requireIg } from './session.js';
import * as store from './store.js';

// type → [label, prepare(config) → config, run(ctx, config)]
const JOBS = {
  'ig-sync': ['Sync', (c) => (requireIg(), c), (ctx) => engines.runSync(ctx)],
  'ig-discover': ['Find people', engines.prepareDiscover, engines.runDiscover],
  'ig-followback': ['Follower review', (c) => (requireIg(), c), engines.runFollowBackScan],
  'ig-follow': ['Follow', engines.prepareList, engines.runFollow],
  'ig-unfollow': ['Unfollow', engines.prepareList, engines.runUnfollow],
  'ig-dm': ['Messages', engines.prepareDm, engines.runDm],
  'ig-posts': ['Posts', engines.preparePosts, engines.runPosts],
  'ig-post-comments': ['Comment cleanup', (c) => (requireIg(), c), engines.runPostComments],
  'ig-activity-scan': ['Comment finder', (c) => (requireIg(), c), engines.runActivityScan],
  'ig-activity-delete': ['Comment removal', (c) => (requireIg(), c), engines.runActivityDelete],
  'ig-unlike': ['Unlike', (c) => (requireIg(), c), engines.runUnlike],
  'ig-autopilot': ['Autopilot', prepareAutopilot, runAutopilot],
};

for (const [type, [, , run]] of Object.entries(JOBS)) {
  defineJob(type, { run, account: () => (ig.demo ? 'demo' : (ig.me?.pk ?? null)) });
}

const IMAGE_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

export function registerInstagram(route) {
  route('POST', '/api/ig/connect', ({ body }) => connectIg(body.cookie, body.remember !== false));
  route('GET', '/api/ig/browsers', () => detectBrowsers());
  // Stays open until the user finishes (or abandons) the login in the browser window.
  route('POST', '/api/ig/login/browser', ({ body }) => loginIgWithBrowser({ remember: body.remember !== false, source: body.source }));
  route('POST', '/api/ig/login/tab', ({ req, body }) => loginIgInBrowserTab({ remember: body.remember !== false, origin: req.headers.origin || `http://${req.headers.host}` }));
  route('POST', '/api/ig/login/cancel', () => ({ cancelled: cancelBrowserLogin() }));
  route('POST', '/api/ig/demo', () => connectIgDemo());
  route('POST', '/api/ig/disconnect', () => (disconnectIg(), igState()));

  route('POST', '/api/ig/jobs', ({ body }) => {
    const job = JOBS[body.type];
    if (!job) throw new HttpError(400, 'Unknown job type.');
    const [label, prepare] = job;
    const config = prepare(body.config || {});
    return startJob(body.type, config.dryRun ? `${label} (preview)` : label, config);
  });

  route('GET', '/api/ig/autopilot', () => autopilotSettings());
  route('GET', '/api/ig/people', ({ query }) => {
    const { me } = requireIg();
    const keep = store.getWhitelist(me.pk);
    return store.relationships(me.pk, query.view).map((row) => ({ ...row, kept: keep.has(row.pk) }));
  });
  route('GET', '/api/ig/queue', ({ query }) => store.queueList(requireIg().me.pk, query.list === 'followback' ? 'followback' : 'grow'));
  route('POST', '/api/ig/queue/skip', ({ body }) => {
    const { me } = requireIg();
    for (const pk of body.pks || []) store.queueMark(me.pk, pk, 'skipped');
  });
  route('POST', '/api/ig/whitelist', ({ body }) => store.setWhitelisted(requireIg().me.pk, String(body.pk), Boolean(body.on)));
  route('GET', '/api/ig/events', ({ query }) => store.listEvents(requireIg().me.pk, String(query.kinds || 'gained,lost').split(',')));
  route('GET', '/api/ig/limits', () => {
    const { me } = requireIg();
    const since = Date.now() - 86400000;
    return { followed: store.eventsSince(me.pk, 'followed', since), unfollowed: store.eventsSince(me.pk, 'unfollowed', since), liked: store.eventsSince(me.pk, 'liked', since) };
  });

  route('GET', '/api/ig/threads', async () => {
    const t = requireIg();
    // First few pages only; "purge all" walks the whole inbox itself.
    return engines.listThreads(null, { api: t.api, pause: async () => {} }, 5);
  });
  route('GET', '/api/ig/posts', ({ query }) => requireIg().api.myPosts(query.cursor || null));
  route('GET', '/api/ig/posts/:id/comments', ({ params, query }) => requireIg().api.comments(params.id, query.cursor || null));
  route('GET', '/api/ig/activity/comments', () => store.foundComments(requireIg().me.pk));

  // Instagram's image CDN refuses to be embedded by other sites, so thumbnails are fetched here.
  route('GET', '/api/ig/img', async ({ query, res }) => {
    requireIg();
    let url;
    try {
      url = new URL(query.u);
    } catch {
      throw new HttpError(400, 'Bad image URL.');
    }
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.test(url.hostname)) throw new HttpError(400, 'Not an Instagram image.');
    const upstream = await fetch(url, { redirect: 'error' });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) throw new HttpError(404, 'Image unavailable.');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
}
