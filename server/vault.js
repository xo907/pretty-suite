import fs from 'node:fs';
import path from 'node:path';
import { MESSAGE_SELECT, attachmentsDir, buildWhere, db, presentRow } from './db.js';

export function queryMessages(q) {
  const { sql, args } = buildWhere(q);
  const limit = Math.min(Number(q.limit) || 60, 500);
  const offset = Number(q.offset) || 0;
  const rows = db.prepare(`${MESSAGE_SELECT} ${sql} ORDER BY m.ts DESC, m.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM messages m ${sql}`).get(...args);
  return { total, messages: rows.map(presentRow) };
}

export function summary() {
  return db
    .prepare(
      `SELECT m.channel_id AS id, m.guild_id, c.name, g.name AS guild_name, COUNT(*) AS count, MAX(m.ts) AS latest
       FROM messages m
       LEFT JOIN channels c ON c.id = m.channel_id
       LEFT JOIN guilds g ON g.id = m.guild_id
       GROUP BY m.channel_id ORDER BY latest DESC`
    )
    .all();
}

export function wipe(q) {
  const { sql, args } = buildWhere(q);
  const channels = db.prepare(`SELECT DISTINCT m.channel_id AS id FROM messages m ${sql}`).all(...args);
  db.prepare(`DELETE FROM edits WHERE message_id IN (SELECT m.id FROM messages m ${sql})`).run(...args);
  const { changes } = db.prepare(`DELETE FROM messages WHERE id IN (SELECT m.id FROM messages m ${sql})`).run(...args);
  // Only remove downloaded files when a whole channel (or everything) is being cleared.
  if (Object.keys(q).every((key) => key === 'channel' || !q[key])) {
    for (const { id } of channels) fs.rmSync(path.join(attachmentsDir, id), { recursive: true, force: true });
  }
  return { removed: Number(changes) };
}

export function insights(q) {
  const { sql, args } = buildWhere(q);
  const and = sql ? `${sql} AND` : 'WHERE';
  const one = (query, ...extra) => db.prepare(query).get(...args, ...extra);
  const many = (query, ...extra) => db.prepare(query).all(...args, ...extra);
  const since = Date.now() - 120 * 86400000;
  return {
    totals: one(
      `SELECT COUNT(*) AS messages, COALESCE(SUM(m.mine), 0) AS mine,
              COALESCE(SUM(m.deleted_ts IS NOT NULL), 0) AS deleted,
              COALESCE(SUM(m.attachments != '[]'), 0) AS withFiles,
              COUNT(DISTINCT m.channel_id) AS channels, COUNT(DISTINCT m.author_id) AS people,
              MIN(m.ts) AS first, MAX(m.ts) AS last
       FROM messages m ${sql}`
    ),
    edits: db.prepare('SELECT COUNT(*) AS n FROM edits').get().n,
    perDay: many(
      `SELECT date(m.ts / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
       FROM messages m ${and} m.ts >= ? GROUP BY day ORDER BY day`,
      since
    ),
    heat: many(
      `SELECT CAST(strftime('%w', m.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS dow,
              CAST(strftime('%H', m.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour, COUNT(*) AS count
       FROM messages m ${sql} GROUP BY dow, hour`
    ),
    topChannels: many(
      `SELECT COALESCE(c.name, m.channel_id) AS name, g.name AS guild_name, COUNT(*) AS count
       FROM messages m LEFT JOIN channels c ON c.id = m.channel_id LEFT JOIN guilds g ON g.id = m.guild_id
       ${sql} GROUP BY m.channel_id ORDER BY count DESC LIMIT 8`
    ),
    topPeople: many(
      `SELECT COALESCE(m.author_name, m.author_id) AS name, COUNT(*) AS count
       FROM messages m ${sql} GROUP BY m.author_id ORDER BY count DESC LIMIT 8`
    ),
  };
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const where = (row) => (row.guild_name ? `${row.guild_name} #${row.channel_name ?? row.channel_id}` : row.channel_name ?? row.channel_id);

const FORMATS = {
  json: {
    type: 'application/json',
    head: '[\n',
    row: (m, i) => (i ? ',\n' : '') + JSON.stringify(m),
    tail: '\n]\n',
  },
  csv: {
    type: 'text/csv',
    head: 'id,timestamp,where,author,author_id,content,attachments,edited,deleted\n',
    row: (m) =>
      [
        m.id,
        new Date(m.ts).toISOString(),
        where(m),
        m.author_name,
        m.author_id,
        m.content,
        m.attachments.map((a) => a.url).join(' '),
        m.edited_ts ? new Date(m.edited_ts).toISOString() : '',
        m.deleted_ts ? new Date(m.deleted_ts).toISOString() : '',
      ]
        .map(csvCell)
        .join(',') + '\n',
    tail: '',
  },
  txt: {
    type: 'text/plain',
    head: '',
    row: (m) =>
      `[${new Date(m.ts).toISOString()}] (${where(m)}) ${m.author_name}: ${m.content}` +
      m.attachments.map((a) => `\n    attachment: ${a.url}`).join('') +
      (m.deleted_ts ? '\n    (deleted)' : '') +
      '\n',
    tail: '',
  },
  html: {
    type: 'text/html',
    head: `<!doctype html><meta charset="utf-8"><title>Pretty Suite export</title><style>
body{background:#0b0b12;color:#e7e7ee;font:14px/1.5 "Segoe UI",system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 16px}
.m{padding:10px 14px;border-radius:12px;margin:6px 0;background:#ffffff0a;border:1px solid #ffffff14}
.h{font-size:12px;color:#9a9ab0}.h b{color:#c4b5fd;font-size:14px}.c{white-space:pre-wrap;word-break:break-word}
.d{border-color:#f8717166}.tag{color:#f87171;font-size:11px;margin-left:6px}a{color:#f0abfc}</style><h1>Pretty Suite export</h1>\n`,
    row: (m) =>
      `<div class="m${m.deleted_ts ? ' d' : ''}"><div class="h"><b>${escapeHtml(m.author_name)}</b> · ${escapeHtml(where(m))} · ${new Date(m.ts).toLocaleString()}` +
      (m.deleted_ts ? '<span class="tag">deleted</span>' : '') +
      (m.edits.length ? '<span class="tag">edited</span>' : '') +
      `</div><div class="c">${escapeHtml(m.content)}</div>` +
      m.attachments.map((a) => `<div><a href="${escapeHtml(a.url)}">${escapeHtml(a.filename)}</a></div>`).join('') +
      '</div>\n',
    tail: '',
  },
};

export function exportMessages(q, res) {
  const format = FORMATS[q.format] ? q.format : 'json';
  const fmt = FORMATS[format];
  const { sql, args } = buildWhere(q);
  res.writeHead(200, {
    'Content-Type': `${fmt.type}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="pretty-suite-export-${new Date().toISOString().slice(0, 10)}.${format}"`,
  });
  res.write(fmt.head);
  let index = 0;
  for (const row of db.prepare(`${MESSAGE_SELECT} ${sql} ORDER BY m.ts ASC, m.id ASC`).iterate(...args)) {
    res.write(fmt.row(presentRow(row), index++));
  }
  res.end(fmt.tail);
}
