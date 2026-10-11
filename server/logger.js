import { db, getChannel, getKV, getMessage, getPresentedMessage, saveMessage, setKV, upsertChannel, upsertGuild } from './db.js';
import { downloadAttachments } from './archive.js';
import { Gateway } from './discord/gateway.js';
import { MockGateway } from './discord/mock.js';
import { broadcast } from './events.js';
import { dmName, guildChannels, requireSession, session } from './session.js';

const DEFAULT_RULES = {
  scope: 'all', // 'all' | 'custom'
  allDms: true,
  selection: { dms: {}, guilds: {} }, // same shape the target picker produces
  captureMine: true,
  captureOthers: true,
  keywords: [],
  downloadAttachments: false,
};

let gateway = null;
let status = 'stopped';
let error = null;
let captured = 0;
const lookedUp = new Set();
let rules = { ...DEFAULT_RULES, ...getKV('discord.logger.rules', {}) };

const insertEdit = db.prepare('INSERT INTO edits (message_id, ts, old_content, new_content) VALUES (?, ?, ?, ?)');
const applyEdit = db.prepare('UPDATE messages SET content = ?, edited_ts = ? WHERE id = ?');
const markDeleted = db.prepare('UPDATE messages SET deleted_ts = ? WHERE id = ? AND deleted_ts IS NULL');

export const loggerState = () => ({ status, error, captured, rules });
const announce = () => broadcast('logger', loggerState());

export function setRules(next) {
  rules = { ...DEFAULT_RULES, ...next };
  rules.keywords = (rules.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  setKV('discord.logger.rules', rules);
  announce();
  return rules;
}

function matches(message) {
  const mine = message.author?.id === session.me?.id;
  if (mine ? !rules.captureMine : !rules.captureOthers) return false;
  if (rules.scope === 'all') return true;
  if (!message.guild_id) return rules.allDms || Boolean(rules.selection.dms?.[message.channel_id]);
  const guild = rules.selection.guilds?.[message.guild_id];
  return guild === true || Boolean(guild?.[message.channel_id]);
}

const isFlagged = (content) => {
  const text = (content || '').toLowerCase();
  return rules.keywords.some((k) => text.includes(k));
};

// The user-account READY payload carries the whole directory; cache names so the feed can label channels.
function cacheDirectory(ready) {
  const users = new Map((ready.users || []).map((u) => [u.id, u]));
  for (const g of ready.guilds || []) {
    const name = g.properties?.name ?? g.name;
    if (name) upsertGuild({ id: g.id, name, icon: g.properties?.icon ?? g.icon });
    for (const c of [...(g.channels || []), ...(g.threads || [])]) {
      upsertChannel({ id: c.id, guild_id: g.id, name: c.name, type: c.type });
    }
  }
  for (const c of ready.private_channels || []) {
    const recipients = c.recipients || (c.recipient_ids || []).map((id) => users.get(id)).filter(Boolean);
    upsertChannel({ id: c.id, guild_id: null, name: dmName({ ...c, recipients }), type: c.type });
  }
}

async function onCreate(message) {
  if (!message.author || !matches(message)) return;
  if (rules.downloadAttachments && message.attachments?.length) await downloadAttachments(message).catch(() => {});
  // A channel we have never seen: learn the server's channel names once so the feed can label it.
  if (message.guild_id && !getChannel(message.channel_id) && !lookedUp.has(message.guild_id)) {
    lookedUp.add(message.guild_id);
    await guildChannels(message.guild_id).catch(() => {});
  }
  saveMessage(message, { source: 'live', meId: session.me.id, flagged: isFlagged(message.content) });
  captured++;
  broadcast('live', { kind: 'create', captured, message: getPresentedMessage(message.id) });
}

function onUpdate(update) {
  if (update.content === undefined) return; // embed-only updates
  const stored = getMessage(update.id);
  if (!stored) return void onCreate(update);
  if (stored.content === update.content) return;
  const ts = update.edited_timestamp ? Date.parse(update.edited_timestamp) : Date.now();
  insertEdit.run(update.id, ts, stored.content, update.content);
  applyEdit.run(update.content, ts, update.id);
  broadcast('live', { kind: 'edit', message: getPresentedMessage(update.id) });
}

function onDelete(id) {
  if (markDeleted.run(Date.now(), id).changes) {
    broadcast('live', { kind: 'delete', message: getPresentedMessage(id) });
  }
}

function onDispatch(type, data) {
  try {
    if (type === 'READY') cacheDirectory(data);
    else if (type === 'MESSAGE_CREATE') onCreate(data);
    else if (type === 'MESSAGE_UPDATE') onUpdate(data);
    else if (type === 'MESSAGE_DELETE') onDelete(data.id);
    else if (type === 'MESSAGE_DELETE_BULK') data.ids.forEach(onDelete);
    else if (type === 'CHANNEL_CREATE' || type === 'THREAD_CREATE') {
      upsertChannel({ id: data.id, guild_id: data.guild_id, name: data.name ?? dmName(data), type: data.type });
    }
  } catch (err) {
    console.error(`Logger failed on ${type}:`, err);
  }
}

export function startLogger() {
  const s = requireSession();
  if (gateway) return loggerState();
  error = null;
  gateway = s.demo ? new MockGateway() : new Gateway(s.token);
  gateway.on('status', (next) => {
    status = next;
    announce();
  });
  gateway.on('fatal', (message) => {
    error = message;
    gateway = null;
    setKV('discord.logger.enabled', false);
    announce();
  });
  gateway.on('dispatch', onDispatch);
  gateway.connect();
  setKV('discord.logger.enabled', true);
  return loggerState();
}

export function stopLogger({ remember = false } = {}) {
  gateway?.close();
  gateway = null;
  status = 'stopped';
  if (!remember) setKV('discord.logger.enabled', false);
  announce();
  return loggerState();
}

/** Called at boot: resume logging if it was running when the app last closed. */
export function resumeLogger() {
  if (session.api && !session.demo && getKV('discord.logger.enabled')) startLogger();
}
