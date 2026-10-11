import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { authRequired, signIn, signOut, signedIn } from './auth.js';
import { HOST, PORT, cacheDir, contentDir, remote, root } from './config.js';
import { attachmentsDir, dataDir, db } from './db.js';
import { attachClient } from './events.js';
import { controlJob, defineJob, hasRunningJobs, listJobs, startJob, suspendJobs } from './jobs.js';
import { prepareArchive, runArchive } from './archive.js';
import { loggerState, resumeLogger, setRules, startLogger, stopLogger } from './logger.js';
import { samplePackage } from './discord/mock.js';
import { registerInstagram } from './instagram/routes.js';
import { igState, restoreIg } from './instagram/session.js';
import { registerReddit } from './reddit/routes.js';
import { rdState, restoreRd } from './reddit/session.js';
import { beginImport, clearPackage, finishImport, ingest, packageSummary } from './package.js';
import { preparePurge, revivePurge, runPurge } from './purge.js';
import { connect, connectDemo, disconnect, guildChannels, publicState, requireSession, restore, session, syncDirectory } from './session.js';
import { HttpError } from './util.js';
import { exportMessages, insights, queryMessages, summary, wipe } from './vault.js';

const DEV = process.argv.includes('--dev');

const routes = [];
const route = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/auth', ({ req }) => ({ required: authRequired, ok: signedIn(req) }));
route('POST', '/api/auth/login', ({ req, res, body }) => signIn(req, res, body.password));
route('POST', '/api/auth/logout', ({ req, res }) => signOut(req, res));
route('GET', '/api/state', () => ({ ...publicState(), logger: loggerState(), dataDir, contentDir, cacheDir, remote, instagram: igState(), reddit: rdState() }));
registerInstagram(route);
registerReddit(route);
route('GET', '/api/events', ({ req, res }) => attachClient(req, res));

route('POST', '/api/discord/connect', ({ req, body }) =>
  connect(body.token, body.remember !== false, { userAgent: req.headers['user-agent'], language: req.headers['accept-language'] })
);
route('POST', '/api/discord/demo', () => connectDemo());
route('POST', '/api/discord/disconnect', () => {
  if (hasRunningJobs()) throw new HttpError(409, 'Cancel running jobs before disconnecting.');
  stopLogger();
  disconnect();
  return publicState();
});
route('GET', '/api/discord/directory', async ({ query }) => {
  requireSession();
  return query.refresh ? syncDirectory() : { guilds: session.guilds, dms: session.dms };
});
route('GET', '/api/discord/guilds/:id/channels', ({ params }) => guildChannels(params.id));

route('GET', '/api/discord/package', () => packageSummary());
route('POST', '/api/discord/package/begin', ({ body }) => beginImport({ userId: body.userId }));
route('POST', '/api/discord/package/chunk', ({ body }) => ingest(body.channels));
route('POST', '/api/discord/package/finish', () => finishImport());
route('POST', '/api/discord/package/clear', () => clearPackage());
route('POST', '/api/discord/package/sample', () => {
  if (!requireSession().demo) throw new HttpError(400, 'The sample package is only available in demo mode.');
  const sample = samplePackage();
  beginImport({ userId: sample.userId, demo: true });
  ingest(sample.channels);
  return finishImport();
});

const discordAccount = () => (session.demo ? 'demo' : (session.me?.id ?? null));
for (const type of ['purge', 'nuke']) defineJob(type, { run: runPurge, account: discordAccount, revive: revivePurge });
defineJob('archive', { run: runArchive, account: discordAccount });

route('GET', '/api/jobs', () => listJobs());
route('POST', '/api/jobs', ({ body }) => {
  if (body.type === 'purge') {
    const config = preparePurge(body.config || {});
    const label = config.nuke ? 'Nuke' : config.dryRun ? 'Scan' : 'Purge';
    const { regex, confirm, ...stored } = config;
    return startJob(config.nuke ? 'nuke' : 'purge', label, stored);
  }
  if (body.type === 'archive') {
    const config = prepareArchive(body.config || {});
    return startJob('archive', 'Archive', config);
  }
  throw new HttpError(400, 'Unknown job type.');
});
route('POST', '/api/jobs/:id/:action', ({ params }) => ({ ok: controlJob(params.id, params.action) }));

route('GET', '/api/vault/messages', ({ query }) => queryMessages(query));
route('GET', '/api/vault/summary', () => summary());
route('GET', '/api/vault/insights', ({ query }) => insights(query));
route('GET', '/api/vault/export', ({ query, res }) => exportMessages(query, res));
route('POST', '/api/vault/wipe', ({ body }) => wipe(body || {}));

route('GET', '/api/logger', () => loggerState());
route('PUT', '/api/logger/rules', ({ body }) => setRules(body));
route('POST', '/api/logger/start', () => startLogger());
route('POST', '/api/logger/stop', () => stopLogger());

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function sendFile(res, base, relative) {
  const file = path.join(base, relative);
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  // Archived files only render inline when they are plain media, so one can never run as a page on this origin.
  const download = base === attachmentsDir && !/^(image\/(?!svg)|video\/|audio\/)/.test(type);
  res.writeHead(200, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    ...(download ? { 'Content-Disposition': 'attachment' } : {}),
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  // This server holds account tokens. Without a password it only answers requests addressed to this machine; with
  // one it can be reached by any address but everything needs the sign-in. Either way it never acts for another site.
  const { host, origin } = req.headers;
  if ((!authRequired && ![`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(host)) || (origin && origin.replace(/^https?:\/\//, '') !== host)) {
    return json(res, 403, { error: 'Forbidden' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  if ((pathname.startsWith('/files/') || (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth'))) && !signedIn(req)) {
    return json(res, 401, { error: 'Sign in first.' });
  }

  if (pathname.startsWith('/api/')) {
    try {
      for (const { method, re, handler } of routes) {
        const match = req.method === method && pathname.match(re);
        if (!match) continue;
        const body = req.method === 'GET' ? {} : await readBody(req);
        const result = await handler({ req, res, body, params: match.groups || {}, query: Object.fromEntries(url.searchParams) });
        if (!res.headersSent) json(res, 200, result ?? { ok: true });
        return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) json(res, err.status || 500, { error: err.message });
      else res.end();
    }
    return;
  }

  if (pathname.startsWith('/files/')) {
    if (!sendFile(res, attachmentsDir, pathname.slice('/files/'.length))) json(res, 404, { error: 'Not found' });
    return;
  }

  if (vite) return vite.middlewares(req, res, () => json(res, 404, { error: 'Not found' }));
  const dist = path.join(root, 'dist');
  if (!sendFile(res, dist, pathname.slice(1)) && !sendFile(res, dist, 'index.html')) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('The UI has not been built yet. Run "npm run build", or use "npm run dev".');
  }
});

let vite = null;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
}

await restore(resumeLogger);
await restoreIg();
await restoreRd();

server.listen(PORT, HOST, () => {
  console.log(
    `\n  Pretty Suite is running at http://${remote ? HOST : 'localhost'}:${PORT}${authRequired ? ' (password required)' : ''}\n` +
      `  Data:    ${dataDir}\n  Content: ${contentDir}\n  Cache:   ${cacheDir}\n`
  );
});

const shutdown = () => {
  suspendJobs();
  stopLogger({ remember: true });
  db.close();
  process.exit(0);
};
// SIGHUP / SIGBREAK: the terminal window was closed.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown);
