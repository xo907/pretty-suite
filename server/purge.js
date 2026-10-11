import { getChannel, getGuild, saveMessage, upsertChannel } from './db.js';
import { closedDmTargets, dropPackageMessage, getPackageChannel, packageMessages } from './package.js';
import { pacer } from './human.js';
import { requireSession } from './session.js';
import { HttpError, msFromSnowflake, parseDate, snowflakeFromMs } from './util.js';

// Default, pin notices, replies, slash-command and context-menu responses etc. System messages can't be deleted.
const isDeletable = (m) => m.type === 0 || (m.type >= 6 && m.type <= 21);

const SCRAMBLE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const scrambled = (length) =>
  Array.from({ length: Math.max(4, Math.min(length, 60)) }, () => SCRAMBLE_CHARS[Math.floor(Math.random() * 36)]).join('');

function targetName(t) {
  if (t.kind === 'guild') return getGuild(t.id)?.name || `Server ${t.id}`;
  if (t.kind === 'package') return `${getPackageChannel(t.id)?.name || t.id} (closed DM)`;
  return getChannel(t.id)?.name || `DM ${t.id}`;
}

// 403, or "Unknown Channel": the conversation itself is out of reach, not just one message.
const isAccessError = (err) => err.status === 403 || err.code === 10003;

export function preparePurge(config) {
  const s = requireSession();
  let targets = config.targets || [];
  if (config.nuke) {
    if (config.confirm !== 'NUKE') throw new HttpError(400, 'Type NUKE to confirm.');
    targets = [
      ...s.dms.map((d) => ({ kind: 'dm', id: d.id })),
      ...closedDmTargets(),
      ...s.guilds.map((g) => ({ kind: 'guild', id: g.id })),
    ];
  }
  if (!targets.length) throw new HttpError(400, 'Pick at least one server or conversation.');
  const filters = config.filters || {};
  let regex = null;
  if (filters.regex) {
    try {
      regex = new RegExp(filters.regex, 'i');
    } catch {
      throw new HttpError(400, 'That regular expression is not valid.');
    }
  }
  return { ...config, targets, filters, regex };
}

/** The compiled filter is not stored with the job, so a resumed purge builds it again. */
export const revivePurge = (config) => ({ ...config, regex: config.filters?.regex ? new RegExp(config.filters.regex, 'i') : null });

export async function runPurge(ctx, config) {
  const { api, me, demo } = requireSession();
  const pace = pacer(ctx, { scale: demo ? 0.05 : 1 });
  const { targets, filters, regex, dryRun, scramble, safetyNet } = config;
  let delay = Math.max(200, Number(config.delayMs) || 1000);
  const after = parseDate(filters.after);
  const before = parseDate(filters.before);

  // Resume point: which target we are on, how far down it the search has got, and whether it has been counted yet.
  const s = ctx.state;
  if (!s.started) {
    ctx.update({ targetsTotal: targets.length, targetsDone: 0, estimated: 0, deleted: 0, skipped: 0, failed: 0, dryRun: Boolean(dryRun) });
    ctx.save({ started: true, index: 0, cursor: null, counted: false, found: 0, handled: 0 });
    ctx.log('info', dryRun ? `Scanning ${targets.length} target(s)…` : `Purging across ${targets.length} target(s)…`);
  }
  /** One message of the current target dealt with: note it, so a restart never goes back over it. */
  const step = (cursor) => {
    s.handled++;
    if (cursor) s.cursor = cursor;
    ctx.update({ progress: (s.index + (s.found ? Math.min(1, s.handled / s.found) : 0)) / targets.length });
    ctx.save();
  };

  /** Deletes one message. Resolves to 'deleted', 'gone' (already removed), or the DiscordError that stopped it. */
  const remove = async (message, guildId) => {
    const path = `/channels/${message.channel_id}/messages/${message.id}`;
    const hitsBefore = api.rateLimitHits;
    let outcome = 'deleted';
    try {
      if (safetyNet) saveMessage(message, { source: 'purge', meId: me.id, guildId });
      if (scramble && message.content) {
        await pace.glance();
        await api.request('PATCH', path, { body: { content: scrambled(message.content.length) }, signal: ctx.signal });
      }
      await api.request('DELETE', path, { signal: ctx.signal });
      ctx.update({ deleted: ctx.stats.deleted + 1 });
    } catch (err) {
      if (err.name !== 'DiscordError') throw err;
      if (err.status === 404 && !isAccessError(err)) {
        outcome = 'gone';
        ctx.update({ skipped: ctx.stats.skipped + 1 });
      } else {
        outcome = err;
      }
    }
    if (api.rateLimitHits > hitsBefore && delay < 4000) {
      delay = Math.min(4000, Math.round(delay * 1.3));
      ctx.log('warn', `Rate limited by Discord, slowing to ${delay} ms between deletions.`);
    }
    await pace.wait(delay / 1000);
    return outcome;
  };

  /** Live targets: find messages through Discord's search, newest first. */
  const purgeBySearch = async (target, name) => {
    const path = target.kind === 'guild' ? `/guilds/${target.id}/messages/search` : `/channels/${target.id}/messages/search`;
    if (dryRun && s.counted) return;
    let cursor = s.cursor ?? (before ? snowflakeFromMs(before) : undefined);
    let first = !s.counted;
    for (;;) {
      await ctx.checkpoint();
      const page = await api.request('GET', path, {
        signal: ctx.signal,
        query: {
          author_id: me.id,
          include_nsfw: true,
          sort_by: 'timestamp',
          sort_order: 'desc',
          max_id: cursor,
          min_id: after ? snowflakeFromMs(after) : undefined,
          content: filters.content,
          has: filters.has,
          channel_id: target.channelIds,
          pinned: filters.pinned === 'only' ? true : filters.pinned === 'skip' ? false : undefined,
        },
      });
      if (page.pending) {
        ctx.log('info', `${name}: Discord is still indexing, waiting…`);
        await ctx.sleep(page.retry_after * 1000 + 500);
        continue;
      }
      if (first) {
        first = false;
        ctx.update({ estimated: ctx.stats.estimated + (page.total_results || 0) });
        ctx.save({ counted: true, found: page.total_results || 0, handled: 0 });
        ctx.log('info', `${name}: ${page.total_results || 0} matching message(s).`);
        if (dryRun) return;
      }
      const hits = (page.messages || []).map((group) => group.find((m) => m.hit) ?? group[0]).filter(Boolean);
      if (!hits.length) return;

      for (const message of hits) {
        await ctx.checkpoint();
        // Step the cursor just below each message so nothing is revisited.
        cursor = String(BigInt(message.id) - 1n);
        if (!isDeletable(message) || (regex && !regex.test(message.content || ''))) {
          ctx.update({ skipped: ctx.stats.skipped + 1 });
          step(cursor);
          continue;
        }
        const outcome = await remove(message, target.kind === 'guild' ? target.id : null);
        if (typeof outcome !== 'string') {
          ctx.update({ failed: ctx.stats.failed + 1 });
          ctx.log('warn', `${name}: could not delete ${message.id} (${outcome.code === 50083 ? 'thread is archived' : outcome.message}).`);
        }
        step(cursor);
      }
    }
  };

  /** Closed DMs from the data package: we already know every message ID, so no search is needed. */
  const purgeFromPackage = async (target, name) => {
    const channel = getPackageChannel(target.id);
    if (!channel) return ctx.log('warn', `${name}: not found in the imported data package.`);
    const needle = filters.content?.toLowerCase();
    const rows = packageMessages(target.id).filter((row) => {
      const ts = msFromSnowflake(row.id);
      if ((after && ts < after) || (before && ts > before)) return false;
      if (needle && !row.content.toLowerCase().includes(needle)) return false;
      if (regex && !regex.test(row.content)) return false;
      // The package has no pin or attachment-type details; "has" narrows to messages with any attachment.
      if (filters.has?.length && !row.attachments) return false;
      return filters.pinned !== 'only';
    });
    // Deleted rows are dropped from the package as we go, so after a restart this list is simply what is left.
    if (!s.counted) {
      ctx.update({ estimated: ctx.stats.estimated + rows.length });
      ctx.save({ counted: true, found: rows.length, handled: 0 });
    }
    ctx.log('info', `${name}: ${rows.length} matching message(s) listed in your data package.`);
    if (dryRun || !rows.length) return;
    if (safetyNet) upsertChannel({ id: channel.id, guild_id: null, name: channel.name, type: 1 });

    let reopened = false;
    let blocked = 0;
    for (const row of rows) {
      await ctx.checkpoint();
      const message = {
        id: row.id,
        channel_id: channel.id,
        type: 0,
        author: me,
        content: row.content,
        timestamp: new Date(msFromSnowflake(row.id)).toISOString(),
        attachments: row.attachments.split(/\s+/).filter(Boolean).map((url, i) => ({
          id: `${row.id}-${i}`,
          url,
          filename: decodeURIComponent(url.split('?')[0].split('/').pop() || 'file'),
        })),
      };
      let outcome = await remove(message, null);
      if (typeof outcome !== 'string' && isAccessError(outcome) && !reopened) {
        // Discord may want the conversation open again before it accepts deletions.
        reopened = true;
        const other = channel.recipients.find((id) => id !== me.id);
        if (other) {
          ctx.log('info', `${name}: reopening the conversation and retrying…`);
          await api.request('POST', '/users/@me/channels', { body: { recipients: [other] }, signal: ctx.signal }).catch(() => {});
          outcome = await remove(message, null);
        }
      }
      if (typeof outcome === 'string') {
        dropPackageMessage(row.id);
        blocked = 0;
        step();
        continue;
      }
      ctx.update({ failed: ctx.stats.failed + 1 });
      step();
      if (isAccessError(outcome) && ++blocked >= 3) {
        ctx.log('warn', `${name}: Discord will not allow access to this conversation any more (${outcome.message}). Moving on.`);
        return;
      }
      ctx.log('warn', `${name}: could not delete ${row.id} (${outcome.message}).`);
    }
  };

  while (s.index < targets.length) {
    await ctx.checkpoint();
    const target = targets[s.index];
    const name = targetName(target);
    ctx.update({ current: name });
    try {
      await (target.kind === 'package' ? purgeFromPackage(target, name) : purgeBySearch(target, name));
    } catch (err) {
      if (err.name !== 'DiscordError') throw err;
      ctx.log('warn', `${name}: skipped (${err.message}).`);
    }
    ctx.save({ index: s.index + 1, cursor: null, counted: false, found: 0, handled: 0 });
    ctx.update({ targetsDone: s.index, progress: s.index / targets.length });
  }

  ctx.update({ current: null });
  ctx.log(
    'success',
    dryRun
      ? `Scan complete: about ${ctx.stats.estimated} message(s) match.`
      : `Done. Deleted ${ctx.stats.deleted}, skipped ${ctx.stats.skipped}, failed ${ctx.stats.failed}.`
  );
}
