import { db, getKV, setKV, upsertChannel, upsertGuild } from './db.js';
import { RestClient } from './discord/rest.js';
import { MockRest } from './discord/mock.js';
import { broadcast } from './events.js';
import { resumeJobs } from './jobs.js';
import { HttpError } from './util.js';

export const session = { api: null, me: null, demo: false, token: null, guilds: [], dms: [] };

const TEXT_CHANNEL_TYPES = new Set([0, 2, 5, 13]); // text, voice chat, announcement, stage chat

export function requireSession() {
  if (!session.api) throw new HttpError(401, 'No Discord account connected.');
  return session;
}

export function dmName(channel) {
  if (channel.name) return channel.name;
  const names = (channel.recipients || []).map((u) => u.global_name || u.username);
  return names.join(', ') || 'Unknown DM';
}

export async function syncDirectory() {
  const { api } = requireSession();
  const [guilds, dms] = await Promise.all([
    api.request('GET', '/users/@me/guilds', { query: { with_counts: true } }),
    api.request('GET', '/users/@me/channels'),
  ]);
  session.guilds = guilds
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon, members: g.approximate_member_count ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  session.dms = dms
    .sort((a, b) => (BigInt(b.last_message_id || 0) > BigInt(a.last_message_id || 0) ? 1 : -1))
    .map((c) => {
      const first = c.recipients?.[0];
      return {
        id: c.id,
        name: dmName(c),
        group: c.type === 3,
        userId: c.type === 1 ? first?.id : null,
        avatar: c.type === 1 ? first?.avatar : null,
      };
    });
  for (const g of session.guilds) upsertGuild(g);
  for (const c of session.dms) upsertChannel({ id: c.id, guild_id: null, name: c.name, type: c.group ? 3 : 1 });
  return { guilds: session.guilds, dms: session.dms };
}

export async function guildChannels(guildId) {
  const { api } = requireSession();
  const all = await api.request('GET', `/guilds/${guildId}/channels`);
  const categories = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c]));
  const channels = all
    .filter((c) => TEXT_CHANNEL_TYPES.has(c.type))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      category: categories.get(c.parent_id)?.name ?? null,
      order: (categories.get(c.parent_id)?.position ?? -1) * 1000 + (c.position ?? 0),
    }))
    .sort((a, b) => a.order - b.order);
  for (const c of channels) upsertChannel({ id: c.id, guild_id: guildId, name: c.name, type: c.type });
  return channels;
}

async function establish(api, { demo, token }) {
  const me = await api.request('GET', '/users/@me');
  Object.assign(session, { api, me, demo, token, guilds: [], dms: [] });
  await syncDirectory();
  broadcast('session', publicState());
  resumeJobs();
  return publicState();
}

export async function connect(token, remember, browser = getKV('discord.browser') || {}) {
  token = String(token || '').trim().replace(/^"|"$/g, '');
  if (!token) throw new HttpError(400, 'Paste your Discord token to connect.');
  try {
    const state = await establish(new RestClient(token, browser), { demo: false, token });
    setKV('discord.token', remember ? token : null);
    setKV('discord.browser', remember && browser.userAgent ? browser : null);
    return state;
  } catch (err) {
    if (err.status === 401) throw new HttpError(401, 'Discord rejected that token. Double-check it and try again.');
    throw err;
  }
}

export const connectDemo = () => establish(new MockRest(), { demo: true, token: null });

/** Demo conversations use reserved fake IDs; keep them out of the real vault once the demo ends. */
export function clearDemoData() {
  const demo = "LIKE '4000000000000000__' OR channel_id LIKE '5000000000000000__'";
  db.exec(`
    DELETE FROM edits WHERE message_id IN (SELECT id FROM messages WHERE channel_id ${demo});
    DELETE FROM messages WHERE channel_id ${demo};
    DELETE FROM channels WHERE id LIKE '4000000000000000__' OR id LIKE '5000000000000000__';
    DELETE FROM guilds WHERE id LIKE '3000000000000000__';
  `);
  if (getKV('discord.package')?.demo) {
    db.exec('DELETE FROM package_messages; DELETE FROM package_channels;');
    setKV('discord.package', null);
  }
}

export function disconnect({ forget = true } = {}) {
  if (session.demo) clearDemoData();
  if (forget) setKV('discord.token', null);
  Object.assign(session, { api: null, me: null, demo: false, token: null, guilds: [], dms: [] });
  broadcast('session', publicState());
}

/** Reconnects with the saved token. `then` runs once that has worked, however long it takes. */
export async function restore(then = () => {}) {
  clearDemoData(); // in case the app was closed mid-demo
  const attempt = async () => {
    const token = getKV('discord.token');
    if (!token || session.api) return;
    try {
      await connect(token, true);
      then();
    } catch (err) {
      console.warn(`Could not restore the saved Discord session: ${err.message}`);
      // Only a rejected token is final. Being offline or Discord being down is not: keep the token and keep trying.
      if (err.status !== 401) setTimeout(attempt, 30000).unref();
    }
  };
  await attempt();
}

export function publicState() {
  const { me } = session;
  return {
    connected: Boolean(session.api),
    demo: session.demo,
    user: me && { id: me.id, username: me.username, name: me.global_name || me.username, avatar: me.avatar },
    counts: { guilds: session.guilds.length, dms: session.dms.length },
  };
}
