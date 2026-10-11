// Demo mode: an in-memory fake Discord account so every feature can be tried without connecting.
import { EventEmitter } from 'node:events';
import { DiscordError } from './rest.js';
import { sleep, snowflakeFromMs } from '../util.js';

const ME = { id: '100000000000000001', username: 'demo.user', global_name: 'Demo User', avatar: null };
const PEOPLE = ['Aria', 'Kenji', 'Mateo', 'Priya', 'Soren', 'Liv', 'Ravi', 'Noor'].map((name, i) => ({
  id: String(200000000000000001n + BigInt(i)),
  username: name.toLowerCase(),
  global_name: name,
  avatar: null,
}));
const LINES = [
  'did anyone see the patch notes?',
  'lol that is actually wild',
  'brb grabbing coffee',
  'here is the link https://example.com/thread/42',
  'ok I pushed the fix, can someone review?',
  'movie night friday?',
  'that meme is going straight into the archive',
  'honestly the new update is so good',
  'can you send me the file again',
  'gg everyone, same time tomorrow',
  'wait what happened in general',
  'I should not have said that, deleting later',
];

let counter = 0n;
const flake = (ms) => String(BigInt(snowflakeFromMs(ms)) + (counter++ % 4096n));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function buildWorld() {
  const guilds = [
    { id: '300000000000000001', name: 'Pixel Foundry', icon: null, approximate_member_count: 1842 },
    { id: '300000000000000002', name: 'Late Night Devs', icon: null, approximate_member_count: 318 },
    { id: '300000000000000003', name: 'Synthwave Lounge', icon: null, approximate_member_count: 9621 },
  ];
  const channels = [];
  guilds.forEach((g, gi) => {
    ['general', 'memes', 'help', 'off-topic'].forEach((name, ci) => {
      channels.push({ id: String(400000000000000000n + BigInt(gi * 10 + ci)), guild_id: g.id, name, type: 0, position: ci });
    });
  });
  const dms = PEOPLE.slice(0, 4).map((p, i) => ({
    id: String(500000000000000001n + BigInt(i)),
    type: 1,
    recipients: [p],
  }));
  dms.push({ id: '500000000000000009', type: 3, name: 'weekend plans', recipients: PEOPLE.slice(4, 7) });

  const messages = [];
  const now = Date.now();
  for (const channel of [...channels, ...dms]) {
    const cast = channel.recipients ? [ME, ...channel.recipients] : [ME, ...PEOPLE];
    const count = 40 + Math.floor(Math.random() * 60);
    for (let i = 0; i < count; i++) {
      const ms = now - Math.floor(Math.random() * 200 * 86400000);
      const author = Math.random() < 0.35 ? ME : pick(cast);
      messages.push(makeMessage(channel, author, ms));
    }
    channel.last_message_id = flake(now);
  }
  return { guilds, channels, dms, messages };
}

function makeMessage(channel, author, ms) {
  const withFile = Math.random() < 0.08;
  return {
    id: flake(ms),
    type: 0,
    channel_id: channel.id,
    guild_id: channel.guild_id,
    author,
    content: pick(LINES),
    timestamp: new Date(ms).toISOString(),
    edited_timestamp: null,
    pinned: Math.random() < 0.02,
    attachments: withFile
      ? [{ id: flake(ms), filename: 'screenshot.png', size: 48213, content_type: 'image/png', url: 'https://example.com/screenshot.png' }]
      : [],
    embeds: [],
  };
}

const world = buildWorld();
const asList = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);

function search(scope, query) {
  let found = world.messages.filter(scope);
  if (query.author_id) found = found.filter((m) => m.author.id === query.author_id);
  if (query.max_id) found = found.filter((m) => BigInt(m.id) < BigInt(query.max_id));
  if (query.min_id) found = found.filter((m) => BigInt(m.id) > BigInt(query.min_id));
  if (query.content) found = found.filter((m) => m.content.toLowerCase().includes(String(query.content).toLowerCase()));
  const channelIds = asList(query.channel_id);
  if (channelIds.length) found = found.filter((m) => channelIds.includes(m.channel_id));
  if (query.pinned !== undefined) found = found.filter((m) => String(m.pinned) === String(query.pinned));
  for (const has of asList(query.has)) {
    if (has === 'file' || has === 'image') found = found.filter((m) => m.attachments.length);
    if (has === 'link') found = found.filter((m) => /https?:\/\//.test(m.content));
  }
  found.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  return { total_results: found.length, messages: found.slice(0, 25).map((m) => [{ ...m, hit: true }]) };
}

export class MockRest {
  constructor() {
    this.rateLimitHits = 0;
  }

  async request(method, path, { query = {}, body, signal } = {}) {
    await sleep(method === 'GET' ? 40 : 90, signal);
    let m;
    if (path === '/users/@me') return ME;
    if (path === '/users/@me/guilds') return world.guilds;
    if (path === '/users/@me/channels') return world.dms;
    if ((m = path.match(/^\/guilds\/(\d+)\/channels$/))) return world.channels.filter((c) => c.guild_id === m[1]);
    if ((m = path.match(/^\/guilds\/(\d+)\/messages\/search$/))) return search((msg) => msg.guild_id === m[1], query);
    if ((m = path.match(/^\/channels\/(\d+)\/messages\/search$/))) return search((msg) => msg.channel_id === m[1], query);
    if ((m = path.match(/^\/channels\/(\d+)\/messages$/))) {
      let found = world.messages.filter((msg) => msg.channel_id === m[1]);
      if (query.before) found = found.filter((msg) => BigInt(msg.id) < BigInt(query.before));
      found.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
      return found.slice(0, Number(query.limit) || 50);
    }
    if ((m = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/))) {
      const index = world.messages.findIndex((msg) => msg.id === m[2]);
      if (index < 0) throw new DiscordError(404, { message: 'Unknown Message', code: 10008 });
      if (method === 'DELETE') return world.messages.splice(index, 1), null;
      if (method === 'PATCH') return Object.assign(world.messages[index], body);
    }
    throw new DiscordError(404, { message: `Demo mode has no handler for ${method} ${path}` });
  }
}

/** A pretend data package: two closed DMs (deletable), a server the demo user left, and one still-open DM. */
export function samplePackage() {
  const now = Date.now();
  const listed = (channelId, count, intoWorld) =>
    Array.from({ length: count }, () => {
      const message = makeMessage({ id: channelId }, ME, now - Math.floor(Math.random() * 600 * 86400000));
      if (intoWorld) world.messages.push(message);
      return { id: message.id, content: message.content, attachments: message.attachments.map((a) => a.url).join(' ') };
    });
  const closed = [
    { id: '500000000000000050', name: 'Juno', user: '200000000000000050', count: 18 },
    { id: '500000000000000051', name: 'Theo', user: '200000000000000051', count: 7 },
  ].map((dm) => {
    world.messages = world.messages.filter((m) => m.channel_id !== dm.id);
    return { id: dm.id, kind: 'dm', name: dm.name, recipients: [ME.id, dm.user], messages: listed(dm.id, dm.count, true) };
  });
  const left = [
    { id: '400000000000000090', name: 'general', count: 64 },
    { id: '400000000000000091', name: 'trading', count: 21 },
  ].map((c) => ({ id: c.id, kind: 'guild', name: c.name, guildId: '300000000000000009', guildName: 'Retro Arcade', messages: listed(c.id, c.count, false) }));
  const open = world.dms[0];
  const stillOpen = {
    id: open.id,
    kind: 'dm',
    name: open.recipients[0].global_name,
    recipients: [ME.id, open.recipients[0].id],
    messages: world.messages.filter((m) => m.channel_id === open.id && m.author.id === ME.id).map((m) => ({ id: m.id, content: m.content, attachments: '' })),
  };
  return { userId: ME.id, channels: [...closed, ...left, stillOpen] };
}

/** Emits a trickle of fake gateway events so the live logger has something to show. */
export class MockGateway extends EventEmitter {
  connect() {
    this.emit('status', 'connected');
    this.timer = setInterval(() => this.#tick(), 2200);
  }

  close() {
    clearInterval(this.timer);
    this.emit('status', 'stopped');
  }

  #tick() {
    const roll = Math.random();
    const recent = world.messages.filter((m) => m.live);
    if (roll < 0.12 && recent.length) {
      const target = pick(recent);
      target.content += ' (edit: typo)';
      target.edited_timestamp = new Date().toISOString();
      this.emit('dispatch', 'MESSAGE_UPDATE', { ...target });
    } else if (roll < 0.22 && recent.length) {
      const target = pick(recent);
      world.messages.splice(world.messages.indexOf(target), 1);
      this.emit('dispatch', 'MESSAGE_DELETE', { id: target.id, channel_id: target.channel_id, guild_id: target.guild_id });
    } else {
      const channel = pick([...world.channels, ...world.dms]);
      const cast = channel.recipients ? [ME, ...channel.recipients] : [ME, ...PEOPLE];
      const message = makeMessage(channel, pick(cast), Date.now());
      message.live = true;
      world.messages.push(message);
      this.emit('dispatch', 'MESSAGE_CREATE', { ...message });
    }
  }
}
