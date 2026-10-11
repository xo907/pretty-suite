// Reddit jobs. Each one first reads through the relevant listings to build a queue, then works through the queue.
// The queue and the position in it live in ctx.state, so a restart carries on from the same item.
import { pacer } from '../human.js';
import { HttpError, parseDate } from '../util.js';
import { requireRd } from './session.js';
import * as store from './store.js';

// Reddit only ever lists the newest ~1000 items of anything. A listing that comes back this full probably has more
// behind it, so the job reads it again (in other orders too) once the first batch has been dealt with.
const LISTING_CAP = 950;
const MAX_ROUNDS = 20;
const SORTS = ['new', 'top', 'controversial', 'hot'];
const FILLER = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'labore', 'magna', 'aliqua'];

function tools(ctx) {
  const { api, me, demo } = requireRd();
  const pace = pacer(ctx, { scale: demo ? 0.01 : 1 });
  return { api, owner: me.name, pause: pace.wait, type: pace.type };
}

const names = (list) => (Array.isArray(list) ? list : String(list || '').split(',')).map((s) => String(s).trim().replace(/^\/?r\//i, '').toLowerCase()).filter(Boolean);
const filler = (length) => Array.from({ length: Math.max(3, Math.min(40, Math.round(length / 6))) }, () => FILLER[Math.floor(Math.random() * FILLER.length)]).join(' ');

/** Reads one listing to the end, in more than one order when it looks cut off. Resolves to whether it was. */
async function readListing(ctx, t, which, onItem) {
  let capped = false;
  for (const sort of which === 'comments' || which === 'submitted' ? SORTS : [null]) {
    let after = null;
    let count = 0;
    do {
      await ctx.checkpoint();
      const page = await t.api.listing(which, { after, sort: sort || undefined }, ctx.signal);
      count += page.items.length;
      for (const item of page.items) onItem(item);
      after = page.next;
      if (after) await t.pause(1.2);
    } while (after);
    if (count < LISTING_CAP) break; // everything was visible: no need for the other orders
    capped = true;
  }
  return capped;
}

/**
 * The shared shape of every job here: scan → queue → act, repeated while listings were cut off.
 *   plan.lists          which listings to read
 *   plan.pick(item, which)  → queue entry, or null to leave the item alone
 *   plan.act(entry)     does the work for one entry
 *   plan.figures(s)     → the numbers to show
 */
async function sweep(ctx, t, plan) {
  const s = ctx.state;
  s.round ??= 0;
  s.done ??= 0;
  s.found ??= 0;
  s.failed ??= [];
  const report = (progress) => ctx.update({ ...(progress === undefined ? {} : { progress }), items: plan.figures(s) });

  while (s.round < MAX_ROUNDS) {
    if (!s.queue) {
      const seen = new Set(s.failed);
      const queue = [];
      let capped = false;
      for (const which of plan.lists) {
        ctx.update({ current: `your ${which === 'submitted' ? 'posts' : which}` });
        const cut = await readListing(ctx, t, which, (item) => {
          if (seen.has(item.name)) return;
          seen.add(item.name);
          const entry = plan.pick(item, which);
          if (entry) queue.push(entry);
          s.scanned = seen.size - s.failed.length;
          report();
        });
        capped ||= cut;
      }
      s.found += queue.length;
      ctx.log('info', plan.found(queue.length, s.round));
      ctx.save({ queue, at: 0, round: s.round + 1, capped });
      ctx.update({ current: null });
    }
    if (plan.dryRun) break;

    while (s.at < s.queue.length) {
      await ctx.checkpoint();
      const entry = s.queue[s.at];
      try {
        await plan.act(entry);
        s.done++;
      } catch (err) {
        if (err.name !== 'RedditError' || err.stop) throw err;
        s.failed.push(entry.name);
        if (s.failed.length <= 5) ctx.log('warn', `${entry.label}: ${err.message}`);
      }
      s.at++;
      ctx.save();
      report(s.at / s.queue.length);
      if (s.at < s.queue.length) await t.pause(plan.pace);
    }
    const again = s.capped && s.queue.length > 0;
    ctx.save({ queue: null });
    if (!again) break;
    ctx.log('info', 'Reddit only shows about 1,000 items at a time. Looking for what was behind those…');
  }
  report(1);
}

// ── Purge: delete my comments and posts ───────────────────────────────────────────────────────────

export function preparePurge(config) {
  requireRd();
  const kinds = { comments: Boolean(config.kinds?.comments), posts: Boolean(config.kinds?.posts) };
  if (!kinds.comments && !kinds.posts) throw new HttpError(400, 'Choose comments, posts, or both.');
  const filters = config.filters || {};
  if (filters.regex) {
    try {
      new RegExp(filters.regex, 'i');
    } catch {
      throw new HttpError(400, 'That regular expression is not valid.');
    }
  }
  if (!config.dryRun && config.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  const { confirm, ...stored } = config;
  return { ...stored, kinds, filters: { ...filters, only: names(filters.only), except: names(filters.except) } };
}

export async function runPurge(ctx, config) {
  const t = tools(ctx);
  const f = config.filters;
  const after = parseDate(f.after);
  const before = parseDate(f.before);
  const regex = f.regex ? new RegExp(f.regex, 'i') : null;
  const needle = f.text?.toLowerCase();
  const keepScore = f.keepScore === '' || f.keepScore === undefined || f.keepScore === null ? null : Number(f.keepScore);
  const matches = (item) => {
    const sub = String(item.subreddit || '').toLowerCase();
    if (f.only.length && !f.only.includes(sub)) return false;
    if (f.except.includes(sub)) return false;
    if ((after && item.ts < after) || (before && item.ts > before)) return false;
    if (keepScore !== null && item.score >= keepScore) return false;
    const text = `${item.title}\n${item.body}`;
    if (needle && !text.toLowerCase().includes(needle)) return false;
    return !regex || regex.test(text);
  };
  const what = config.dryRun ? 'Matching' : 'Deleted';

  await sweep(ctx, t, {
    dryRun: config.dryRun,
    pace: Number(config.pace) || 2,
    lists: [...(config.kinds.comments ? ['comments'] : []), ...(config.kinds.posts ? ['submitted'] : [])],
    pick(item) {
      if (!matches(item)) return null;
      if (config.safetyNet && !config.dryRun) store.saveItem(t.owner, item, 'purge');
      return { name: item.name, label: `${item.kind === 'comment' ? 'Comment' : 'Post'} in r/${item.subreddit}`, editable: item.isSelf && !item.archived, length: item.body.length };
    },
    async act(entry) {
      if (config.overwrite && entry.editable) {
        // Overwriting first means anything that copied the text before deletion keeps the replacement, not the original.
        try {
          const text = config.overwriteText?.trim() || filler(entry.length);
          await t.type(text);
          await t.api.edit(entry.name, text, ctx.signal);
          await t.pause(1);
        } catch (err) {
          if (err.name !== 'RedditError' || err.stop) throw err;
        }
      }
      await t.api.remove(entry.name, ctx.signal);
      store.markDeleted(t.owner, entry.name);
    },
    found: (count, round) => (config.dryRun ? `${count} item(s) match.` : round ? `${count} more to delete.` : `${count} item(s) to delete.`),
    figures: (s) => [['Looked at', s.scanned ?? 0], [what, config.dryRun ? s.found : s.done], ...(config.dryRun ? [] : [['Found', s.found], ['Failed', s.failed.length]])],
  });
  const s = ctx.state;
  ctx.log('success', config.dryRun ? `Scan complete: ${s.found} item(s) match.` : `Done. Deleted ${s.done}, failed ${s.failed.length}.`);
}

// ── Archive: keep a local copy ────────────────────────────────────────────────────────────────────

export async function runArchive(ctx, config) {
  const t = tools(ctx);
  const s = ctx.state;
  s.fresh ??= 0;
  await sweep(ctx, t, {
    dryRun: true, // reading is the whole job
    lists: ['comments', 'submitted', ...(config.saved ? ['saved'] : [])],
    pick(item, which) {
      if (store.saveItem(t.owner, item, which === 'saved' ? 'saved' : 'archive')) s.fresh++;
      return null;
    },
    found: () => `Saved ${s.scanned ?? 0} item(s) to your archive, ${s.fresh} of them new.`,
    figures: () => [['Saved', s.scanned ?? 0], ['New', s.fresh]],
  });
  ctx.log('success', 'Archive is up to date.');
}

// ── Activity: saved items, votes and hidden posts ─────────────────────────────────────────────────

const ACTIVITY = {
  saved: { label: 'Saved', act: 'unsave' },
  upvoted: { label: 'Upvote', act: 'unvote' },
  downvoted: { label: 'Downvote', act: 'unvote' },
  hidden: { label: 'Hidden post', act: 'unhide' },
};

export function prepareActivity(config) {
  requireRd();
  const lists = Object.keys(ACTIVITY).filter((key) => config[key]);
  if (!lists.length) throw new HttpError(400, 'Choose at least one thing to clear.');
  return { ...config, lists };
}

export async function runActivity(ctx, config) {
  const t = tools(ctx);
  await sweep(ctx, t, {
    pace: Number(config.pace) || 1.5,
    lists: config.lists,
    pick: (item, which) => ({ name: item.name, list: which, label: `${ACTIVITY[which].label} in r/${item.subreddit}` }),
    act: (entry) => t.api[ACTIVITY[entry.list].act](entry.name, ctx.signal),
    found: (count, round) => (round ? `${count} more to clear.` : `${count} item(s) to clear.`),
    figures: (s) => [['Cleared', s.done], ['Found', s.found], ['Could not clear', s.failed.length]],
  });
  const s = ctx.state;
  ctx.log('success', `Done. Cleared ${s.done} item(s)${s.failed.length ? `; ${s.failed.length} could not be changed (Reddit locks votes on posts older than six months)` : ''}.`);
}

// ── Communities: leave in bulk ────────────────────────────────────────────────────────────────────

export function prepareLeave(config) {
  requireRd();
  if (!config.names?.length) throw new HttpError(400, 'Select at least one community.');
  return config;
}

export async function runLeave(ctx, config) {
  const t = tools(ctx);
  const s = ctx.state;
  s.at ??= 0;
  s.done ??= 0;
  while (s.at < config.names.length) {
    await ctx.checkpoint();
    const name = config.names[s.at];
    try {
      await t.api.leave(name, ctx.signal);
      s.done++;
    } catch (err) {
      if (err.name !== 'RedditError' || err.stop) throw err;
      ctx.log('warn', `r/${config.titles?.[name] || name}: ${err.message}`);
    }
    s.at++;
    ctx.save();
    ctx.update({ progress: s.at / config.names.length, items: [['Left', s.done], ['Remaining', config.names.length - s.at]] });
    if (s.at < config.names.length) await t.pause(Number(config.pace) || 1.5);
  }
  ctx.log('success', `Left ${s.done} communit${s.done === 1 ? 'y' : 'ies'}.`);
}

export async function listCommunities() {
  const { api } = requireRd();
  const all = [];
  let after = null;
  do {
    const page = await api.communities(after);
    all.push(...page.items);
    after = page.next;
  } while (after && all.length < 5000);
  return all.sort((a, b) => a.title.localeCompare(b.title));
}
