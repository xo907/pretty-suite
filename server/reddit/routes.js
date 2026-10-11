import { cancelBrowserLogin } from '../browserLogin.js';
import { defineJob, startJob } from '../jobs.js';
import { HttpError } from '../util.js';
import * as engines from './engines.js';
import { connectRd, connectRdDemo, disconnectRd, loginRdInBrowserTab, loginRdWithBrowser, rd, rdState, requireRd } from './session.js';
import * as store from './store.js';

// type → [label, prepare(config) → config, run(ctx, config)]
const JOBS = {
  'rd-purge': ['Purge', engines.preparePurge, engines.runPurge],
  'rd-archive': ['Archive', (c) => (requireRd(), c), engines.runArchive],
  'rd-activity': ['Clear activity', engines.prepareActivity, engines.runActivity],
  'rd-leave': ['Leave communities', engines.prepareLeave, engines.runLeave],
};
for (const [type, [, , run]] of Object.entries(JOBS)) {
  defineJob(type, { run, account: () => (rd.demo ? 'demo' : (rd.me?.name ?? null)) });
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function registerReddit(route) {
  const origin = (req) => req.headers.origin || `http://${req.headers.host}`;
  route('POST', '/api/rd/connect', ({ body }) => connectRd(body.cookie, body.remember !== false));
  // Both stay open until the user finishes (or abandons) the login in the browser.
  route('POST', '/api/rd/login/tab', ({ req, body }) => loginRdInBrowserTab({ remember: body.remember !== false, origin: origin(req) }));
  route('POST', '/api/rd/login/browser', ({ body }) => loginRdWithBrowser({ remember: body.remember !== false }));
  route('POST', '/api/rd/login/cancel', () => ({ cancelled: cancelBrowserLogin() }));
  route('POST', '/api/rd/demo', () => connectRdDemo());
  route('POST', '/api/rd/disconnect', () => (disconnectRd(), rdState()));

  route('POST', '/api/rd/jobs', ({ body }) => {
    const job = JOBS[body.type];
    if (!job) throw new HttpError(400, 'Unknown job type.');
    const [label, prepare] = job;
    const config = prepare(body.config || {});
    return startJob(body.type, config.dryRun ? 'Scan' : label, config);
  });

  route('GET', '/api/rd/communities', () => engines.listCommunities());
  route('GET', '/api/rd/archive', ({ query }) => store.listItems(requireRd().me.name, query));
  route('GET', '/api/rd/archive/summary', () => store.archiveSummary(requireRd().me.name));
  route('GET', '/api/rd/archive/export', ({ query, res }) => {
    const rows = store.allItems(requireRd().me.name, query);
    const csv = query.format === 'csv';
    res.writeHead(200, {
      'Content-Type': `${csv ? 'text/csv' : 'application/json'}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="reddit-archive-${new Date().toISOString().slice(0, 10)}.${csv ? 'csv' : 'json'}"`,
    });
    if (!csv) return res.end(JSON.stringify(rows.map(({ owner, ...row }) => row), null, 2));
    res.write('date,kind,subreddit,score,title,body,url,permalink,deleted\n');
    for (const r of rows) {
      res.write([new Date(r.ts).toISOString(), r.kind, r.subreddit, r.score, r.title, r.body, r.url, r.permalink, r.deleted_ts ? new Date(r.deleted_ts).toISOString() : ''].map(csvCell).join(',') + '\n');
    }
    res.end();
  });
}
