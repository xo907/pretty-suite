// Discord data package import: the only source for DMs you have closed and servers you have left.
// The browser parses the zip and sends the message list here in chunks.
import { db, getKV, setKV } from './db.js';
import { requireSession } from './session.js';
import { HttpError } from './util.js';

const insertChannel = db.prepare(
  'INSERT OR REPLACE INTO package_channels (id, kind, name, guild_id, guild_name, recipients) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertMessage = db.prepare('INSERT OR REPLACE INTO package_messages (id, channel_id, content, attachments) VALUES (?, ?, ?, ?)');
const channelById = db.prepare('SELECT * FROM package_channels WHERE id = ?');
const messagesFor = db.prepare('SELECT * FROM package_messages WHERE channel_id = ? ORDER BY LENGTH(id) DESC, id DESC');
const dropMessage = db.prepare('DELETE FROM package_messages WHERE id = ?');

const isId = (value) => /^\d{5,25}$/.test(String(value ?? ''));

export function clearPackage() {
  db.exec('DELETE FROM package_messages; DELETE FROM package_channels;');
  setKV('discord.package', null);
}

export function beginImport({ userId, demo = false } = {}) {
  const { me } = requireSession();
  if (userId && String(userId) !== me.id) {
    throw new HttpError(400, `This data package belongs to a different Discord account than the one connected (${me.username}).`);
  }
  clearPackage();
  setKV('discord.package', { ownerId: me.id, imported: null, demo });
}

export function ingest(channels = []) {
  db.exec('BEGIN');
  try {
    for (const c of channels) {
      if (!isId(c.id)) continue;
      const kind = ['dm', 'group', 'guild'].includes(c.kind) ? c.kind : 'guild';
      insertChannel.run(
        String(c.id),
        kind,
        c.name ? String(c.name) : null,
        isId(c.guildId) ? String(c.guildId) : null,
        c.guildName ? String(c.guildName) : null,
        JSON.stringify((c.recipients || []).filter(isId).map(String))
      );
      for (const m of c.messages || []) {
        if (isId(m.id)) insertMessage.run(String(m.id), String(c.id), String(m.content ?? ''), String(m.attachments ?? ''));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function finishImport() {
  const meta = getKV('discord.package');
  if (!meta) throw new HttpError(400, 'No import in progress.');
  setKV('discord.package', { ...meta, imported: Date.now() });
  return packageSummary();
}

/** Sorts everything in the package into: still reachable normally, closed DMs, and places you have left. */
export function packageSummary() {
  const s = requireSession();
  const meta = getKV('discord.package');
  if (!meta?.imported || meta.ownerId !== s.me.id) return { imported: null };

  const rows = db
    .prepare(
      `SELECT c.id, c.kind, c.name, c.guild_id, c.guild_name, COUNT(m.id) AS count
       FROM package_channels c JOIN package_messages m ON m.channel_id = c.id
       GROUP BY c.id ORDER BY count DESC`
    )
    .all();
  const open = new Set(s.dms.map((d) => d.id));
  const joined = new Set(s.guilds.map((g) => g.id));
  const servers = new Map();
  const summary = {
    imported: meta.imported,
    closedDms: [],
    leftGroups: [],
    leftServers: [],
    covered: { places: 0, messages: 0 },
    totals: { channels: rows.length, messages: 0 },
  };

  for (const row of rows) {
    summary.totals.messages += row.count;
    const reachable = row.kind === 'guild' ? row.guild_id && joined.has(row.guild_id) : open.has(row.id);
    if (reachable) {
      summary.covered.places++;
      summary.covered.messages += row.count;
    } else if (row.kind === 'dm') {
      summary.closedDms.push({ id: row.id, name: row.name || 'Unknown user', count: row.count });
    } else if (row.kind === 'group') {
      summary.leftGroups.push({ id: row.id, name: row.name || 'Unnamed group', count: row.count });
    } else {
      const key = row.guild_id || 'unknown';
      const entry = servers.get(key) || { id: key, known: Boolean(row.guild_id), name: row.guild_name || 'Unknown or deleted servers', count: 0, channels: 0 };
      entry.count += row.count;
      entry.channels++;
      servers.set(key, entry);
    }
  }
  summary.leftServers = [...servers.values()].sort((a, b) => b.count - a.count);
  return summary;
}

export const closedDmTargets = () => (packageSummary().closedDms || []).map((dm) => ({ kind: 'package', id: dm.id }));

export function getPackageChannel(id) {
  const row = channelById.get(id);
  return row && { ...row, recipients: JSON.parse(row.recipients || '[]') };
}
export const packageMessages = (channelId) => messagesFor.all(channelId);
export const dropPackageMessage = (id) => dropMessage.run(id);
