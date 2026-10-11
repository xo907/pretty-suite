import { pacer } from '../human.js';
import { HttpError, parseDate } from '../util.js';
import { requireIg } from './session.js';
import * as store from './store.js';

const DAY = 86400000;

/** Per-job helpers. Pauses follow a human rhythm (see human.js); the demo runs 100× faster. */
export function tools(ctx) {
  const { api, me, demo } = requireIg();
  const pace = pacer(ctx, { scale: demo ? 0.01 : 1 });
  return {
    api,
    me,
    demo,
    owner: me.pk,
    pause: pace.wait,
    glance: pace.glance,
    show: (progress, items) => ctx.update({ progress, items }),
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────────────────────────

/** Heuristic 0–100 estimate of how likely an account is to follow back, with the reasons behind it. */
export function scoreProfile(p) {
  let score = 40;
  const reasons = [];
  const note = (delta, text) => {
    score += delta;
    if (text) reasons.push({ text, tone: delta > 0 ? 'good' : 'bad' });
  };
  const ratio = p.following / Math.max(p.followers, 1);
  if (ratio >= 1.5) note(30, 'Follows far more people than follow them');
  else if (ratio >= 0.8) note(20, 'Follows about as many people as follow them');
  else if (ratio >= 0.4) note(8);
  else if (ratio < 0.2) note(-25, 'Rarely follows anyone');

  if (p.followers < 2000) note(15, 'Small account');
  else if (p.followers < 10000) note(5);
  else if (p.followers > 50000) note(-20, 'Very large account');

  const idleDays = p.lastPostTs ? (Date.now() - p.lastPostTs) / DAY : null;
  if (idleDays !== null && idleDays <= 30) note(15, 'Posted in the last month');
  else if (p.posts === 0) note(-15, 'Has never posted');
  else if (idleDays !== null && idleDays > 180) note(-15, 'No posts in over six months');

  if (p.noPic) note(-15, 'No profile picture');
  if (p.isVerified) note(-25, 'Verified account');
  if (p.isPrivate) note(-5, 'Private account');
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Reasons (if any) this account is ruled out by the user's exclusion rules. */
export function exclusions(p, rules, score) {
  const out = [];
  if (rules.noPic && p.noPic) out.push('No profile picture');
  if (rules.private && p.isPrivate) out.push('Private account');
  if (rules.verified && p.isVerified) out.push('Verified account');
  if (rules.inactive) {
    const days = Number(rules.inactiveDays) || 90;
    if (p.posts === 0) out.push('Has never posted');
    else if (p.lastPostTs && Date.now() - p.lastPostTs > days * DAY) out.push(`No posts in ${days}+ days`);
  }
  if (rules.highRatio) {
    const ratio = p.followers / Math.max(p.following, 1);
    if (p.followers >= 500 && ratio >= (Number(rules.ratio) || 5)) {
      out.push(`${Math.round(ratio)}× more followers than following — likely to unfollow`);
    }
  }
  if (rules.minScore && score < rules.minScore) out.push(`Follow-back score under ${rules.minScore}`);
  return out.map((text) => ({ text, tone: 'block' }));
}

/** Full profile for a user, from the cache when it is under a week old. */
export async function enrich(t, ctx, user) {
  const cached = store.getUser(user.pk);
  if (cached?.enrichedTs > Date.now() - 7 * DAY) return cached;
  try {
    store.saveUser(await t.api.profile(user.username, ctx.signal, user.pk));
  } catch (err) {
    if (err.name !== 'IgError' || err.stop) throw err;
    return null; // deleted, renamed or unavailable
  } finally {
    await t.pause(2.5);
  }
  return store.getUser(user.pk);
}

export function judge(profile, rules) {
  const { score, reasons } = scoreProfile(profile);
  const blocked = exclusions(profile, rules, score);
  const said = new Set(blocked.map((b) => b.text));
  return { score, verdict: blocked.length ? 'excluded' : 'ok', reasons: [...blocked, ...reasons.filter((r) => !said.has(r.text))] };
}

export const followsLeftToday = (t, cap) => Math.max(0, (Number(cap) || 40) - store.eventsSince(t.owner, 'followed', Date.now() - DAY));

export async function followOne(t, ctx, user) {
  await t.glance();
  await t.api.follow(user.pk, ctx.signal);
  store.markFollowing(t.owner, user.pk, true);
  store.addEvent(t.owner, 'followed', user);
  store.queueMark(t.owner, user.pk, 'followed');
}

// Every job below keeps its position in ctx.state and calls ctx.save() after each step that must not be
// repeated, so a job interrupted by a restart carries on from that step instead of starting over.

// ── Sync: snapshot followers and following ────────────────────────────────────────────────────────

export async function runSync(ctx) {
  const t = tools(ctx);
  const s = (ctx.state.sync ??= { kind: 'followers', cursor: null, followers: [], following: [] });
  // No total is given up front; the profile's own counts (or the last sync) are close enough for a progress bar.
  const last = store.relationshipCounts(t.owner);
  const expected = (t.me.followers || 0) + (t.me.following || 0) || last.followers + last.following;
  const report = () => {
    const got = s.followers.length + s.following.length;
    t.show(expected ? Math.min(0.99, got / expected) : s.kind === 'followers' ? 0.25 : 0.75, [['Followers', s.followers.length], ['Following', s.following.length]]);
  };
  while (s.kind !== 'done') {
    await ctx.checkpoint();
    const page = await t.api[s.kind](t.owner, s.cursor, ctx.signal);
    for (const user of page.items) (store.saveUser(user), s[s.kind].push(user.pk));
    s.cursor = page.next;
    if (!s.cursor) s.kind = s.kind === 'followers' ? 'following' : 'done';
    ctx.save();
    report();
    if (s.kind !== 'done') await t.pause(1.5);
  }
  const lists = Object.fromEntries(['followers', 'following'].map((kind) => [kind, new Map(s[kind].map((pk) => [pk, store.getUser(pk) || { pk }]))]));
  const { gained, lost } = store.saveSnapshot(t.owner, lists.followers, lists.following);
  delete ctx.state.sync;
  ctx.save();
  t.show(1, [['Followers', lists.followers.size], ['Following', lists.following.size], ['New', gained], ['Lost', lost]]);
  ctx.log('success', `Synced ${lists.followers.size} followers and ${lists.following.size} following. ${gained} new, ${lost} lost since last time.`);
}

// ── Grow: find people worth following ─────────────────────────────────────────────────────────────

const clean = (list) => (list || []).map((s) => String(s).trim().replace(/^[@#]/, '')).filter(Boolean);

export function prepareDiscover(config) {
  requireIg();
  const sources = { keywords: clean(config.keywords), hashtags: clean(config.hashtags), similarTo: clean(config.similarTo) };
  if (!sources.keywords.length && !sources.hashtags.length && !sources.similarTo.length) {
    throw new HttpError(400, 'Add at least one keyword, hashtag or account to look around.');
  }
  return { ...config, ...sources, limit: Math.min(Math.max(Number(config.limit) || 40, 1), 500) };
}

export async function runDiscover(ctx, config) {
  const t = tools(ctx);
  const s = ctx.state;
  const rules = config.rules || {};
  const pace = Number(config.pace) || 30;

  if (!s.candidates) {
    const skip = new Set([t.owner, ...store.iFollow(t.owner), ...store.queueSeen(t.owner, 'grow')]);
    const found = new Map();
    const collect = (users, source) => {
      for (const user of users) {
        if (skip.has(user.pk) || found.has(user.pk)) continue;
        store.saveUser(user);
        found.set(user.pk, { pk: user.pk, source });
      }
    };
    const gather = async (label, work) => {
      await ctx.checkpoint();
      try {
        const before = found.size;
        await work();
        ctx.log('info', `${label}: ${found.size - before} new account(s).`);
      } catch (err) {
        if (err.name !== 'IgError' || err.stop) throw err;
        ctx.log('warn', `${label}: ${err.message}`);
      }
      await t.pause(2);
    };

    for (const keyword of config.keywords) {
      await gather(`Keyword “${keyword}”`, async () => collect(await t.api.searchUsers(keyword, ctx.signal), `keyword: ${keyword}`));
    }
    for (const tag of config.hashtags) {
      await gather(`#${tag}`, async () => collect(await t.api.hashtagUsers(tag, ctx.signal), `#${tag}`));
    }
    for (const username of config.similarTo) {
      await gather(`Similar to @${username}`, async () => {
        const target = await t.api.profile(username, ctx.signal);
        collect(await t.api.similar(target.pk, ctx.signal), `similar to @${username}`);
        if (config.includeFollowers) {
          await t.pause(2);
          collect((await t.api.followers(target.pk, null, ctx.signal)).items, `follows @${username}`);
        }
      });
    }
    ctx.save({ candidates: [...found.values()].slice(0, config.limit), checked: 0, good: [], followed: 0 });
    ctx.log('info', `Checking ${s.candidates.length} profile(s)…`);
  }

  // The bar covers both halves: checking profiles (a few seconds each) and, on autopilot, the paced follows after it.
  const total = s.candidates.length;
  const planned = () => (config.autoFollow ? (s.queue ? s.queue.length : Math.min(followsLeftToday(t, config.dailyCap), Math.ceil(total / 2))) : 0);
  const progress = () => (total ? (s.checked * 3 + s.followed * pace) / (total * 3 + planned() * pace) : 1);

  while (s.checked < total) {
    await ctx.checkpoint();
    const { pk, source } = s.candidates[s.checked];
    const user = store.getUser(pk);
    const profile = user && (await enrich(t, ctx, user));
    if (profile) {
      const verdict = judge(profile, rules);
      store.queueAdd(t.owner, 'grow', pk, { source, ...verdict });
      if (verdict.verdict === 'ok') s.good.push({ pk, score: verdict.score });
    }
    s.checked++;
    ctx.save();
    t.show(progress(), [['Checked', s.checked], ['Good matches', s.good.length], ['Ruled out', s.checked - s.good.length]]);
  }

  if (config.autoFollow && s.good.length) {
    if (!s.queue) {
      const budget = followsLeftToday(t, config.dailyCap);
      ctx.save({ queue: [...s.good].sort((a, b) => b.score - a.score).slice(0, budget).map((g) => g.pk) });
      ctx.log('info', `Autopilot: following the best matches (${budget} follow(s) left in today's limit).`);
    }
    while (s.followed < s.queue.length) {
      await ctx.checkpoint();
      const user = store.getUser(s.queue[s.followed]);
      if (user) await followOne(t, ctx, user);
      s.followed++;
      ctx.save();
      t.show(progress(), [['Checked', s.checked], ['Good matches', s.good.length], ['Followed', s.followed]]);
      if (s.followed < s.queue.length) await t.pause(pace);
    }
  }
  ctx.update({ progress: 1 });
  ctx.log('success', `Found ${s.good.length} good match(es) out of ${s.checked} checked${config.autoFollow ? `, followed ${s.followed}` : ''}.`);
}

// ── Follow back: review the people who follow you ─────────────────────────────────────────────────

export async function runFollowBackScan(ctx, config) {
  const t = tools(ctx);
  const s = ctx.state;
  if (!s.fans) {
    if (!s.synced && (!store.lastSynced(t.owner) || config.resync)) {
      ctx.log('info', 'Refreshing your follower list first…');
      await runSync(ctx);
      ctx.save({ synced: true });
    }
    store.queueClearPending(t.owner, 'followback');
    ctx.save({ fans: store.relationships(t.owner, 'fans').slice(0, Math.min(Number(config.limit) || 100, 2000)).map((fan) => fan.pk), checked: 0, ok: 0 });
    ctx.log('info', `Reviewing ${s.fans.length} follower(s) you do not follow back…`);
  }
  while (s.checked < s.fans.length) {
    await ctx.checkpoint();
    const pk = s.fans[s.checked];
    const fan = store.getUser(pk);
    const profile = fan && (await enrich(t, ctx, fan));
    if (profile) {
      const verdict = judge(profile, config.rules || {});
      store.queueAdd(t.owner, 'followback', pk, { source: 'follows you', ...verdict });
      if (verdict.verdict === 'ok') s.ok++;
    }
    s.checked++;
    ctx.save();
    t.show(s.checked / s.fans.length, [['Reviewed', s.checked], ['Worth following', s.ok], ['Excluded', s.checked - s.ok]]);
  }
  ctx.update({ progress: 1 });
  ctx.log('success', `${s.ok} worth following back, ${s.checked - s.ok} excluded by your rules.`);
}

// ── Follow / unfollow a chosen set ────────────────────────────────────────────────────────────────

function usersFor(config) {
  const users = (config.pks || []).map((pk) => store.getUser(pk)).filter(Boolean);
  if (!users.length) throw new HttpError(400, 'Select at least one account.');
  return users;
}
export const prepareList = (config) => (requireIg(), usersFor(config), config);

export async function runFollow(ctx, config) {
  const t = tools(ctx);
  const users = usersFor(config);
  const s = ctx.state;
  s.at ??= 0;
  s.done ??= 0;
  while (s.at < users.length) {
    await ctx.checkpoint();
    if (!followsLeftToday(t, config.dailyCap)) {
      ctx.log('warn', `Daily follow limit reached. ${users.length - s.at} left for tomorrow.`);
      break;
    }
    await followOne(t, ctx, users[s.at]);
    s.at++;
    s.done++;
    ctx.save();
    t.show(s.at / users.length, [['Followed', s.done], ['Remaining', users.length - s.at]]);
    if (s.at < users.length) await t.pause(Number(config.pace) || 30);
  }
  ctx.log('success', `Followed ${s.done} account(s).`);
}

export async function runUnfollow(ctx, config) {
  const t = tools(ctx);
  const keep = store.getWhitelist(t.owner);
  const users = usersFor(config);
  const cap = Number(config.dailyCap) || 60;
  const s = ctx.state;
  s.at ??= 0;
  s.done ??= 0;
  while (s.at < users.length) {
    await ctx.checkpoint();
    const user = users[s.at];
    if (keep.has(user.pk)) {
      s.at++;
      continue;
    }
    if (store.eventsSince(t.owner, 'unfollowed', Date.now() - DAY) >= cap) {
      ctx.log('warn', `Daily unfollow limit reached. ${users.length - s.at} left for tomorrow.`);
      break;
    }
    await t.glance();
    await t.api.unfollow(user.pk, ctx.signal);
    store.markFollowing(t.owner, user.pk, false);
    store.addEvent(t.owner, 'unfollowed', user);
    s.at++;
    s.done++;
    ctx.save();
    t.show(s.at / users.length, [['Unfollowed', s.done], ['Remaining', users.length - s.at]]);
    if (s.at < users.length) await t.pause(Number(config.pace) || 25);
  }
  ctx.log('success', `Unfollowed ${s.done} account(s).`);
}

// ── Direct messages ───────────────────────────────────────────────────────────────────────────────

export function prepareDm(config) {
  requireIg();
  if (!config.all && !config.threadIds?.length) throw new HttpError(400, 'Select at least one conversation.');
  if (config.all && config.confirm !== 'PURGE') throw new HttpError(400, 'Type PURGE to confirm.');
  if (!config.unsend && !config.remove) throw new HttpError(400, 'Choose what to do: unsend your messages, remove the conversations, or both.');
  return config;
}

export async function listThreads(ctx, t, limitPages = 500) {
  const threads = [];
  let cursor = null;
  let pages = 0;
  do {
    await ctx?.checkpoint();
    const page = await t.api.inbox(cursor, ctx?.signal);
    threads.push(...page.items);
    cursor = page.next;
    if (cursor && ctx) await t.pause(1.2);
  } while (cursor && ++pages < limitPages);
  return threads;
}

const describeItem = (item) =>
  `${String(item.type || 'message').replace(/^MESSAGE_/, '').toLowerCase().replace(/_/g, ' ')} item from ${new Date(item.ts).toLocaleDateString()}`;

export async function runDm(ctx, config) {
  const t = tools(ctx);
  const before = parseDate(config.before);
  const s = ctx.state;
  if (!s.threads) {
    const threads = config.all ? await listThreads(ctx, t) : config.threadIds.map((id) => ({ id, title: config.titles?.[id] || id }));
    ctx.save({ threads: threads.map(({ id, title }) => ({ id, title })), at: 0, unsent: 0, removed: 0 });
    ctx.log('info', `Working through ${s.threads.length} conversation(s)…`);
  }
  const report = () => t.show(s.threads.length ? s.at / s.threads.length : 1, [['Messages unsent', s.unsent], ['Conversations removed', s.removed], ['Done', `${s.at}/${s.threads.length}`]]);
  while (s.at < s.threads.length) {
    await ctx.checkpoint();
    const thread = s.threads[s.at];
    ctx.update({ current: thread.title });
    try {
      if (config.unsend) {
        // Unsent messages are gone from the thread, so reading it again after a restart only finds what is left.
        let cursor = null;
        let here = 0;
        // Some items cannot be unsent (notices like "you named the group", expired media…). Those are passed over,
        // but a run of refusals means the whole conversation is off limits, so it is left alone after a few.
        let refused = 0;
        let streak = 0;
        do {
          await ctx.checkpoint();
          const page = await t.api.threadItems(thread.id, cursor, ctx.signal);
          for (const item of page.items) {
            if (item.userId !== t.owner || (before && item.ts >= before)) continue;
            await ctx.checkpoint();
            try {
              await t.api.unsend(thread.id, item.id, ctx.signal);
              s.unsent++;
              here++;
              streak = 0;
              ctx.save();
              report();
            } catch (err) {
              if (err.name !== 'IgError' || err.stop) throw err;
              if (!refused++) ctx.log('warn', `${thread.title}: Instagram would not unsend a ${describeItem(item)} (${err.message})`);
              if (++streak >= 5) break;
            }
            await t.pause(Number(config.pace) || 2);
          }
          cursor = streak >= 5 ? null : page.next;
          if (cursor) await t.pause(1);
        } while (cursor);
        ctx.log(refused ? 'warn' : 'info', `${thread.title}: unsent ${here} message(s)${refused ? `, ${refused} could not be unsent${streak >= 5 ? ' (stopped trying after 5 in a row)' : ''}` : ''}.`);
      }
      if (config.remove) {
        await t.api.hideThread(thread.id, ctx.signal);
        s.removed++;
        await t.pause(2);
      }
    } catch (err) {
      if (err.name !== 'IgError' || err.stop) throw err;
      ctx.log('warn', `${thread.title}: ${err.message}`);
    }
    s.at++;
    ctx.save();
    report();
  }
  ctx.update({ current: null });
  ctx.log('success', `Done. Unsent ${s.unsent} message(s), removed ${s.removed} conversation(s).`);
}

// ── Posts and comments ────────────────────────────────────────────────────────────────────────────

export function preparePosts(config) {
  requireIg();
  if (!config.ids?.length) throw new HttpError(400, 'Select at least one post.');
  return config;
}

export async function runPosts(ctx, config) {
  const t = tools(ctx);
  const archive = config.action === 'archive';
  const s = ctx.state;
  s.at ??= 0;
  while (s.at < config.ids.length) {
    await ctx.checkpoint();
    const id = config.ids[s.at];
    await (archive ? t.api.archivePost(id, ctx.signal) : t.api.deletePost(id, ctx.signal));
    s.at++;
    ctx.save();
    t.show(s.at / config.ids.length, [[archive ? 'Archived' : 'Deleted', s.at], ['Remaining', config.ids.length - s.at]]);
    await t.pause(4);
  }
  ctx.log('success', `${archive ? 'Archived' : 'Deleted'} ${s.at} post(s).`);
}

async function eachPage(ctx, t, fetchPage, onItems, maxItems = Infinity) {
  let cursor = null;
  let seen = 0;
  do {
    await ctx.checkpoint();
    const page = await fetchPage(cursor);
    seen += page.items.length;
    if ((await onItems(page.items)) === false) return;
    cursor = page.next;
    if (cursor) await t.pause(1.5);
  } while (cursor && seen < maxItems);
}

/** Bulk-remove comments other people left on my posts, by keyword and/or author. */
export async function runPostComments(ctx, config) {
  const t = tools(ctx);
  const words = clean(config.keywords).map((w) => w.toLowerCase());
  const authors = new Set(clean(config.usernames).map((u) => u.toLowerCase()));
  const matches = (c) =>
    c.userId !== t.owner &&
    (config.everything || words.some((w) => c.text.toLowerCase().includes(w)) || authors.has(c.username.toLowerCase()));
  if (!config.everything && !words.length && !authors.size) throw new HttpError(400, 'Add a keyword or username, or choose to remove every comment.');

  const s = ctx.state;
  s.checked ??= []; // posts already dealt with, skipped when the list is walked again after a restart
  s.found ??= 0;
  s.deleted ??= 0;
  const total = config.postIds?.length || t.me.posts || 0;
  const report = () =>
    ctx.update({
      ...(total ? { progress: Math.min(0.99, s.checked.length / total) } : {}),
      items: [['Posts checked', s.checked.length], ['Matching', s.found], ...(config.dryRun ? [] : [['Deleted', s.deleted]])],
    });
  await eachPage(ctx, t, (cursor) => t.api.myPosts(cursor, ctx.signal), async (batch) => {
    for (const post of batch) {
      if (config.postIds?.length && !config.postIds.includes(post.id)) continue;
      if (s.checked.includes(post.id)) continue;
      const hits = [];
      await eachPage(ctx, t, (cursor) => t.api.comments(post.id, cursor, ctx.signal), (comments) => void hits.push(...comments.filter(matches)));
      // A post interrupted half-way is read again after a restart; its matches were already counted the first time.
      if (s.counted !== post.id) {
        s.found += hits.length;
        ctx.save({ counted: post.id });
      }
      report();
      for (const comment of config.dryRun ? [] : hits) {
        await ctx.checkpoint();
        await t.api.deleteComment(post.id, comment.id, ctx.signal);
        s.deleted++;
        ctx.save();
        report();
        await t.pause(2);
      }
      s.checked.push(post.id);
      ctx.save();
      report();
    }
  });
  ctx.update({ progress: 1 });
  ctx.log('success', config.dryRun ? `${s.found} matching comment(s) across ${s.checked.length} post(s).` : `Deleted ${s.deleted} comment(s) across ${s.checked.length} post(s).`);
}

/** Look through posts I liked for comments I wrote. Instagram offers no direct list of them. */
export async function runActivityScan(ctx, config) {
  const t = tools(ctx);
  const maxPosts = Math.min(Number(config.maxPosts) || 100, 5000);
  const pagesPerPost = Math.min(Number(config.depth) || 2, 20);
  const s = ctx.state;
  // Saved once per page of liked posts, together with the counts as they stood at that point.
  let { cursor = null, posts = 0, found = 0 } = s;
  while (!s.finished) {
    await ctx.checkpoint();
    const page = await t.api.liked(cursor, ctx.signal);
    for (const post of page.items) {
      if (posts >= maxPosts) break;
      let pages = 0;
      try {
        await eachPage(ctx, t, (at) => (pages++ < pagesPerPost ? t.api.comments(post.id, at, ctx.signal) : { items: [], next: null }), (comments) => {
          for (const c of comments.filter((c) => c.userId === t.owner)) {
            store.saveFoundComment(t.owner, { id: c.id, mediaId: post.id, code: post.code, postOwner: post.owner?.username, text: c.text, ts: c.ts });
            found++;
          }
        });
      } catch (err) {
        if (err.name !== 'IgError' || err.stop) throw err;
      }
      posts++;
      t.show(posts / maxPosts, [['Posts checked', posts], ['My comments found', found]]);
    }
    cursor = page.next;
    ctx.save({ cursor, posts, found, finished: !cursor || posts >= maxPosts });
    if (!s.finished) await t.pause(1.5);
  }
  ctx.update({ progress: 1 });
  ctx.log('success', `Found ${found} of your comment(s) across ${posts} post(s) you liked.`);
}

export async function runActivityDelete(ctx, config) {
  const t = tools(ctx);
  const wanted = new Set(config.ids || []);
  const s = ctx.state;
  // Each comment leaves this list as it is handled, so after a restart it holds exactly what is left.
  const comments = store.foundComments(t.owner).filter((c) => config.all || wanted.has(c.id));
  if (!comments.length && !s.total) throw new HttpError(400, 'Select at least one comment.');
  s.total ??= comments.length;
  s.handled ??= 0;
  s.deleted ??= 0;
  for (const comment of comments) {
    await ctx.checkpoint();
    try {
      await t.api.deleteComment(comment.mediaId, comment.id, ctx.signal);
      s.deleted++;
    } catch (err) {
      if (err.name !== 'IgError' || err.stop) throw err;
      ctx.log('warn', `Comment on @${comment.postOwner}'s post: ${err.message}`);
    }
    store.dropFoundComment(t.owner, comment.id);
    s.handled++;
    ctx.save();
    t.show(s.handled / s.total, [['Deleted', s.deleted], ['Remaining', s.total - s.handled]]);
    await t.pause(3);
  }
  ctx.log('success', `Deleted ${s.deleted} comment(s).`);
}

export async function runUnlike(ctx, config) {
  const t = tools(ctx);
  const limit = Math.min(Number(config.limit) || 100, 10000);
  const s = ctx.state;
  s.removed ??= 0;
  // Unliking empties the first page, so keep asking for the top of the list.
  while (s.removed < limit) {
    await ctx.checkpoint();
    const page = await t.api.liked(null, ctx.signal);
    if (!page.items.length) break;
    for (const post of page.items) {
      if (s.removed >= limit) break;
      await ctx.checkpoint();
      await t.api.unlike(post.id, ctx.signal);
      s.removed++;
      ctx.save();
      t.show(s.removed / limit, [['Likes removed', s.removed]]);
      await t.pause(Number(config.pace) || 3);
    }
  }
  ctx.update({ progress: 1 });
  ctx.log('success', `Removed ${s.removed} like(s).`);
}
