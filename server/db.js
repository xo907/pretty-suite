import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { contentDir, dataDir } from './config.js';

export { dataDir };
export const attachmentsDir = contentDir;

export const db = new DatabaseSync(path.join(dataDir, 'pretty.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS guilds (id TEXT PRIMARY KEY, name TEXT, icon TEXT);
  CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT, type INTEGER);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'discord',
    channel_id TEXT NOT NULL,
    guild_id TEXT,
    author_id TEXT,
    author_name TEXT,
    author_username TEXT,
    author_avatar TEXT,
    content TEXT,
    ts INTEGER,
    edited_ts INTEGER,
    type INTEGER,
    attachments TEXT,
    embeds TEXT,
    reply_to TEXT,
    source TEXT,
    mine INTEGER DEFAULT 0,
    deleted_ts INTEGER,
    flagged INTEGER DEFAULT 0,
    saved_ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, ts);
  CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
  CREATE INDEX IF NOT EXISTS idx_messages_author ON messages (author_id);
  CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    ts INTEGER,
    old_content TEXT,
    new_content TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_edits_message ON edits (message_id);
  CREATE TABLE IF NOT EXISTS package_channels (
    id TEXT PRIMARY KEY, kind TEXT, name TEXT, guild_id TEXT, guild_name TEXT, recipients TEXT
  );
  CREATE TABLE IF NOT EXISTS package_messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, content TEXT, attachments TEXT);
  CREATE INDEX IF NOT EXISTS idx_package_messages_channel ON package_messages (channel_id);
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, type TEXT, status TEXT, config TEXT, stats TEXT, created INTEGER, finished INTEGER
  );
`);

const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
const kvSet = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const kvDel = db.prepare('DELETE FROM kv WHERE key = ?');

export function getKV(key, fallback = null) {
  const row = kvGet.get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setKV(key, value) {
  if (value === null || value === undefined) kvDel.run(key);
  else kvSet.run(key, JSON.stringify(value));
}

const guildUpsert = db.prepare(
  'INSERT INTO guilds (id, name, icon) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon'
);
const channelUpsert = db.prepare(
  'INSERT INTO channels (id, guild_id, name, type) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET guild_id = excluded.guild_id, name = excluded.name, type = excluded.type'
);
export const upsertGuild = (g) => guildUpsert.run(g.id, g.name ?? null, g.icon ?? null);
export const upsertChannel = (c) => channelUpsert.run(c.id, c.guild_id ?? null, c.name ?? null, c.type ?? null);

const channelGet = db.prepare('SELECT * FROM channels WHERE id = ?');
const guildGet = db.prepare('SELECT * FROM guilds WHERE id = ?');
export const getChannel = (id) => channelGet.get(id);
export const getGuild = (id) => guildGet.get(id);

const msgGet = db.prepare('SELECT * FROM messages WHERE id = ?');
const msgUpsert = db.prepare(`
  INSERT INTO messages (id, channel_id, guild_id, author_id, author_name, author_username, author_avatar, content, ts,
                        edited_ts, type, attachments, embeds, reply_to, source, mine, flagged, saved_ts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    content = excluded.content, edited_ts = excluded.edited_ts, attachments = excluded.attachments,
    embeds = excluded.embeds, author_name = excluded.author_name, author_avatar = excluded.author_avatar,
    guild_id = COALESCE(excluded.guild_id, messages.guild_id),
    flagged = MAX(messages.flagged, excluded.flagged)
`);

export const getMessage = (id) => msgGet.get(id);

/** Store a raw Discord message object. Returns { isNew, previous }. */
export function saveMessage(m, { source, meId, guildId = null, flagged = false }) {
  const previous = msgGet.get(m.id);
  const prevAtts = previous?.attachments ? JSON.parse(previous.attachments) : [];
  const attachments = (m.attachments || []).map((a) => ({
    id: a.id,
    filename: a.filename,
    url: a.url,
    size: a.size,
    content_type: a.content_type,
    local: a.local ?? prevAtts.find((p) => p.id === a.id)?.local,
  }));
  const author = m.author || {};
  msgUpsert.run(
    m.id,
    m.channel_id,
    m.guild_id ?? guildId ?? null,
    author.id ?? null,
    author.global_name || author.username || null,
    author.username ?? null,
    author.avatar ?? null,
    m.content ?? '',
    m.timestamp ? Date.parse(m.timestamp) : Date.now(),
    m.edited_timestamp ? Date.parse(m.edited_timestamp) : null,
    m.type ?? 0,
    JSON.stringify(attachments),
    JSON.stringify(m.embeds || []),
    m.message_reference?.message_id ?? null,
    source,
    author.id === meId ? 1 : 0,
    flagged ? 1 : 0,
    Date.now()
  );
  return { isNew: !previous, previous };
}

/** Shared filter builder for the vault, exports and insights. */
export function buildWhere(q = {}) {
  const where = [];
  const args = [];
  const add = (sql, ...a) => (where.push(sql), args.push(...a));
  if (q.q) add("m.content LIKE ? ESCAPE '\\'", `%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`);
  if (q.channel) add('m.channel_id = ?', q.channel);
  if (q.guild) add('m.guild_id = ?', q.guild);
  if (q.author) add('(m.author_id = ? OR m.author_username = ?)', q.author, q.author);
  if (q.mine === '1') add('m.mine = 1');
  if (q.mine === '0') add('m.mine = 0');
  if (q.deleted === '1') add('m.deleted_ts IS NOT NULL');
  if (q.edited === '1') add('EXISTS (SELECT 1 FROM edits e WHERE e.message_id = m.id)');
  if (q.flagged === '1') add('m.flagged = 1');
  if (q.source) add('m.source = ?', q.source);
  if (q.after) add('m.ts >= ?', Number(q.after));
  if (q.before) add('m.ts <= ?', Number(q.before));
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

export const MESSAGE_SELECT = `
  SELECT m.*, c.name AS channel_name, c.type AS channel_type, g.name AS guild_name,
         (SELECT COUNT(*) FROM edits e WHERE e.message_id = m.id) AS edit_count
  FROM messages m
  LEFT JOIN channels c ON c.id = m.channel_id
  LEFT JOIN guilds g ON g.id = m.guild_id
`;

const rowById = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`);
const editsFor = db.prepare('SELECT ts, old_content, new_content FROM edits WHERE message_id = ? ORDER BY id');

export function presentRow(row) {
  if (!row) return null;
  return {
    ...row,
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
    embeds: row.embeds ? JSON.parse(row.embeds) : [],
    edits: row.edit_count ? editsFor.all(row.id) : [],
  };
}
export const getPresentedMessage = (id) => presentRow(rowById.get(id));
