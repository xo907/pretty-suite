import fs from 'node:fs';
import path from 'node:path';
import { attachmentsDir, getChannel, getGuild, saveMessage } from './db.js';
import { pacer } from './human.js';
import { guildChannels, requireSession } from './session.js';
import { HttpError, parseDate, snowflakeFromMs } from './util.js';

/** Downloads each attachment next to the database and records its local path on the object. */
export async function downloadAttachments(message, signal) {
  let saved = 0;
  for (const att of message.attachments || []) {
    if (att.local || !att.url) continue;
    try {
      const res = await fetch(att.url, { signal });
      if (!res.ok) continue;
      const dir = path.join(attachmentsDir, message.channel_id);
      fs.mkdirSync(dir, { recursive: true });
      const file = `${att.id}-${String(att.filename || 'file').replace(/[^\w.\-]+/g, '_')}`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
      att.local = `${message.channel_id}/${file}`;
      saved++;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  return saved;
}

export function prepareArchive(config) {
  requireSession();
  if (!config.targets?.length) throw new HttpError(400, 'Pick at least one server or conversation.');
  const userIds = String(config.userIds || '').split(/[\s,]+/).filter(Boolean);
  return { ...config, userIds, scope: config.scope || 'both' };
}

export async function runArchive(ctx, config) {
  const { api, me } = requireSession();
  const pace = pacer(ctx, { breaks: false }); // reading back through history is one continuous scroll
  const after = parseDate(config.after);
  const before = parseDate(config.before);
  const only = new Set(config.userIds);

  // Resume point: the expanded channel list, which channel we are on, and how far back in it we have read.
  const s = ctx.state;
  const channels = s.channels || [];
  // Expand whole-server targets into their individual channels.
  for (const target of s.channels ? [] : config.targets) {
    await ctx.checkpoint();
    if (target.kind === 'dm') {
      channels.push({ id: target.id, guildId: null, name: getChannel(target.id)?.name || target.id });
      continue;
    }
    const guildName = getGuild(target.id)?.name || target.id;
    try {
      const all = await guildChannels(target.id);
      for (const c of all) {
        if (target.channelIds && !target.channelIds.includes(c.id)) continue;
        channels.push({ id: c.id, guildId: target.id, name: `${guildName} › #${c.name}` });
      }
    } catch (err) {
      if (err.name !== 'DiscordError') throw err;
      ctx.log('warn', `${guildName}: could not list channels (${err.message}).`);
    }
  }

  if (!s.channels) {
    ctx.update({ channelsTotal: channels.length, channelsDone: 0, scanned: 0, saved: 0, files: 0 });
    ctx.save({ channels, index: 0, cursor: null });
    ctx.log('info', `Archiving ${channels.length} channel(s)…`);
  }

  while (s.index < channels.length) {
    await ctx.checkpoint();
    const channel = channels[s.index];
    ctx.update({ current: channel.name });
    let cursor = s.cursor ?? (before ? snowflakeFromMs(before) : undefined);
    let savedHere = 0;
    try {
      for (;;) {
        await ctx.checkpoint();
        const page = await api.request('GET', `/channels/${channel.id}/messages`, {
          query: { limit: 100, before: cursor },
          signal: ctx.signal,
        });
        if (!page.length) break;
        let reachedStart = false;
        let savedInPage = 0;
        for (const message of page) {
          cursor = message.id;
          if (after && Date.parse(message.timestamp) < after) {
            reachedStart = true;
            break;
          }
          const mine = message.author?.id === me.id;
          if ((config.scope === 'mine' && !mine) || (config.scope === 'others' && mine)) continue;
          if (only.size && !only.has(message.author?.id)) continue;
          if (config.downloadAttachments && message.attachments?.length) {
            ctx.stats.files += await downloadAttachments(message, ctx.signal);
          }
          saveMessage(message, { source: 'archive', meId: me.id, guildId: channel.guildId });
          savedInPage++;
        }
        savedHere += savedInPage;
        ctx.update({ scanned: ctx.stats.scanned + page.length, saved: ctx.stats.saved + savedInPage });
        ctx.save({ cursor });
        if (reachedStart || page.length < 100) break;
        await pace.wait(Math.max(100, Number(config.delayMs) || 350) / 1000);
      }
      ctx.log('info', `${channel.name}: saved ${savedHere} message(s).`);
    } catch (err) {
      if (err.name !== 'DiscordError') throw err;
      ctx.log('warn', `${channel.name}: skipped (${err.status === 403 ? 'no access' : err.message}).`);
    }
    ctx.save({ index: s.index + 1, cursor: null });
    ctx.update({ channelsDone: s.index, progress: channels.length ? s.index / channels.length : 1 });
  }

  ctx.update({ current: null });
  ctx.log('success', `Done. Saved ${ctx.stats.saved} message(s) and ${ctx.stats.files} file(s) to your vault.`);
}
