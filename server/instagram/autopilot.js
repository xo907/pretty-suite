// Autopilot: one endless job that looks after the account on its own. It works in short sessions at irregular
// times round the clock — following good matches, unfollowing people who never followed back, liking posts — and
// keeps inside a daily plan that is itself varied from day to day. Its position lives in ctx.state, so a restart
// carries on with the same day's plan and the same next wake-up time.
import { getKV, setKV } from '../db.js';
import { humanSeconds } from '../human.js';
import { listJobs } from '../jobs.js';
import { Cancelled, HttpError } from '../util.js';
import { enrich, followOne, followsLeftToday, judge, runSync, tools } from './engines.js';
import { requireIg } from './session.js';
import * as store from './store.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KINDS = ['follow', 'unfollow', 'like'];
const NOUN = { follow: 'follows', unfollow: 'unfollows', like: 'likes' };

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const whole = (value, min, max, fallback) => Math.min(max, Math.max(min, Math.round(Number(value)) || fallback));
const clean = (list) => (Array.isArray(list) ? list : String(list || '').split(',')).map((s) => String(s).trim().replace(/^[@#]/, '')).filter(Boolean);

export const DEFAULT_AUTOPILOT = {
  follow: { on: true, perDay: 25, keywords: [], hashtags: [], similarTo: [], rules: { noPic: true, inactive: true, inactiveDays: 90, highRatio: true, ratio: 5, private: false, verified: true, minScore: 55 } },
  unfollow: { on: true, perDay: 25, afterDays: 4, everyone: false },
  like: { on: true, perDay: 40, following: true, followers: true, newFollows: true },
  quiet: { on: false, from: 1, to: 7 },
};

const settingsKey = () => `instagram.autopilot.${requireIg().me.pk}`;
export const autopilotSettings = () => ({ ...DEFAULT_AUTOPILOT, ...getKV(settingsKey(), {}) });

export function prepareAutopilot(input) {
  requireIg();
  if (listJobs().some((job) => job.type === 'ig-autopilot' && ['running', 'interrupted'].includes(job.status))) {
    throw new HttpError(409, 'Autopilot is already running. Stop it first to change its settings.');
  }
  const d = DEFAULT_AUTOPILOT;
  const config = {
    follow: {
      on: Boolean(input.follow?.on),
      perDay: whole(input.follow?.perDay, 1, 150, d.follow.perDay),
      keywords: clean(input.follow?.keywords),
      hashtags: clean(input.follow?.hashtags),
      similarTo: clean(input.follow?.similarTo),
      rules: { ...d.follow.rules, ...input.follow?.rules },
    },
    unfollow: {
      on: Boolean(input.unfollow?.on),
      perDay: whole(input.unfollow?.perDay, 1, 150, d.unfollow.perDay),
      afterDays: whole(input.unfollow?.afterDays, 1, 60, d.unfollow.afterDays),
      everyone: Boolean(input.unfollow?.everyone),
    },
    like: {
      on: Boolean(input.like?.on),
      perDay: whole(input.like?.perDay, 1, 300, d.like.perDay),
      following: Boolean(input.like?.following),
      followers: Boolean(input.like?.followers),
      newFollows: Boolean(input.like?.newFollows),
    },
    quiet: { on: Boolean(input.quiet?.on), from: whole(input.quiet?.from, 0, 23, d.quiet.from) % 24, to: whole(input.quiet?.to, 0, 23, d.quiet.to) % 24 },
  };
  if (!KINDS.some((kind) => config[kind].on)) throw new HttpError(400, 'Switch on at least one thing for Autopilot to do.');
  if (config.follow.on && !config.follow.keywords.length && !config.follow.hashtags.length && !config.follow.similarTo.length) {
    throw new HttpError(400, 'Tell Autopilot where to find people to follow: add a keyword, hashtag or similar account.');
  }
  if (config.like.on && !config.like.following && !config.like.followers && !config.like.newFollows) {
    throw new HttpError(400, 'Choose whose posts Autopilot should like.');
  }
  setKV(settingsKey(), config);
  return config;
}

export async function runAutopilot(ctx, config) {
  const t = tools(ctx);
  const s = ctx.state;
  s.blocks ??= []; // when Instagram last pushed back
  s.off = {}; // kinds of action the website turned out not to offer; tried afresh each time the app starts
  s.dry ??= {}; // when a kind last had nothing to work on
  s.fresh ??= []; // accounts just followed, due a like
  s.likedIds ??= [];
  const speed = t.demo ? 0.004 : 1; // the demo lives a day in a few minutes
  const today = () => new Date().toLocaleDateString('en-CA');
  const untilTomorrow = () => new Date(new Date().setHours(24, 0, 0, 0)) - Date.now();
  let doing = null;

  const left = () => ({
    follow: config.follow.on && !s.off.follow ? Math.max(0, Math.min(s.plan.follow - s.done.follow, followsLeftToday(t, config.follow.perDay))) : 0,
    unfollow:
      config.unfollow.on && !s.off.unfollow
        ? Math.max(0, Math.min(s.plan.unfollow - s.done.unfollow, config.unfollow.perDay - store.eventsSince(t.owner, 'unfollowed', Date.now() - DAY)))
        : 0,
    like: config.like.on && !s.off.like ? Math.max(0, s.plan.like - s.done.like) : 0,
  });
  const show = (what) => {
    const planned = KINDS.reduce((sum, kind) => sum + s.plan[kind], 0);
    const done = KINDS.reduce((sum, kind) => sum + Math.min(s.done[kind], s.plan[kind]), 0);
    ctx.update({
      endless: true,
      progress: planned ? done / planned : 0,
      next: s.nextAt || null,
      nextWhat: what ?? ctx.stats.nextWhat ?? null,
      items: KINDS.filter((kind) => config[kind].on).map((kind) => [`${kind === 'like' ? 'Liked' : kind === 'follow' ? 'Followed' : 'Unfollowed'} today`, `${s.done[kind]} of ~${s.plan[kind]}`]),
    });
  };
  /** Sleeps until a set time. The time is saved first, so a restart mid-wait does not cut it short or start it over. */
  const wait = async (ms, what) => {
    ctx.save({ nextAt: Date.now() + ms * speed });
    show(what);
    await rest();
  };
  const rest = async () => {
    while (s.nextAt && Date.now() < s.nextAt) {
      await ctx.checkpoint();
      await ctx.sleep(Math.min(s.nextAt - Date.now(), 4000));
    }
    ctx.save({ nextAt: null });
  };
  const pause = (min, max) => ctx.sleep(humanSeconds((min + max) / 2) * 1000 * speed);

  const newDay = () => {
    const vary = (kind) => (config[kind].on ? Math.max(1, Math.round(config[kind].perDay * rand(0.7, 1))) : 0);
    ctx.save({ day: today(), plan: { follow: vary('follow'), unfollow: vary('unfollow'), like: vary('like') }, done: { follow: 0, unfollow: 0, like: 0 }, dry: {} });
    ctx.log('info', `Plan for today: ${KINDS.filter((kind) => config[kind].on).map((kind) => `about ${s.plan[kind]} ${NOUN[kind]}`).join(', ')}, spread over the day.`);
  };

  const inQuietHours = () => {
    if (!config.quiet.on || config.quiet.from === config.quiet.to) return 0;
    const now = new Date();
    const hour = now.getHours();
    const { from, to } = config.quiet;
    if (!(from < to ? hour >= from && hour < to : hour >= from || hour < to)) return 0;
    const end = new Date(now);
    end.setHours(to, 0, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end - now;
  };

  /** Who followed back is only known from a fresh follower list, so it is re-read a few times a day. */
  const syncIfDue = async () => {
    s.syncGap ??= rand(7, 11) * HOUR;
    const last = store.lastSynced(t.owner);
    if (last && Date.now() - last < s.syncGap * speed) return;
    doing = null;
    ctx.log('info', 'Refreshing your follower lists…');
    await runSync(ctx);
    ctx.save({ syncGap: rand(7, 11) * HOUR });
  };

  const candidates = () => store.queueList(t.owner, 'grow').filter((row) => row.verdict === 'ok');

  /** Looks in one of the configured places and scores a handful of new profiles. */
  const discover = async () => {
    const { keywords, hashtags, similarTo, rules } = config.follow;
    const [kind, term] = pick([...keywords.map((k) => ['keyword', k]), ...hashtags.map((h) => ['hashtag', h]), ...similarTo.map((u) => ['similar', u])]);
    const skip = new Set([t.owner, ...store.iFollow(t.owner), ...store.queueSeen(t.owner, 'grow'), ...store.everUnfollowed(t.owner)]);
    let users = [];
    let source = '';
    try {
      if (kind === 'keyword') (users = await t.api.searchUsers(term, ctx.signal)), (source = `keyword: ${term}`);
      else if (kind === 'hashtag') (users = await t.api.hashtagUsers(term, ctx.signal)), (source = `#${term}`);
      else {
        const target = await t.api.profile(term, ctx.signal);
        await pause(2, 5);
        users = (await t.api.followers(target.pk, null, ctx.signal)).items;
        source = `follows @${term}`;
      }
    } catch (err) {
      if (err.name !== 'IgError' || err.stop) throw err;
      ctx.log('warn', `Looking under ${kind} “${term}” failed: ${err.message}`);
      return;
    }
    const fresh = users.filter((user) => !skip.has(user.pk)).sort(() => Math.random() - 0.5).slice(0, 8);
    let good = 0;
    for (const user of fresh) {
      await ctx.checkpoint();
      store.saveUser(user);
      const profile = await enrich(t, ctx, user);
      if (!profile) continue;
      const verdict = judge(profile, rules);
      store.queueAdd(t.owner, 'grow', user.pk, { source, ...verdict });
      if (verdict.verdict === 'ok') good++;
    }
    ctx.log('info', `Looked at ${fresh.length} new profile(s) from ${source}: ${good} worth following.`);
  };

  /** Each returns 'done', 'skip' (tried, nothing came of it) or 'none' (nothing to work on right now). */
  const act = {
    async follow() {
      let list = candidates();
      if (list.length < 2 && (!s.lastDiscover || Date.now() - s.lastDiscover > 30 * MIN * speed)) {
        ctx.save({ lastDiscover: Date.now() });
        await discover();
        list = candidates();
      }
      const row = list[0];
      const user = row && store.getUser(row.pk);
      if (!user) return 'none';
      try {
        await followOne(t, ctx, user);
      } catch (err) {
        if (err.name !== 'IgError' || err.stop) throw err;
        store.queueMark(t.owner, user.pk, 'skipped');
        ctx.log('warn', `Could not follow @${user.username}: ${err.message}`);
        return 'skip';
      }
      ctx.log('info', `Followed @${user.username} (${row.score}% likely to follow back).`);
      if (config.like.on && config.like.newFollows) s.fresh = [...s.fresh, user.pk].slice(-30);
      return 'done';
    },

    async unfollow() {
      const keep = store.getWhitelist(t.owner);
      const cutoff = Date.now() - config.unfollow.afterDays * DAY * speed;
      const due = store
        .relationships(t.owner, 'nonfollowers')
        .filter((row) => !keep.has(row.pk) && (row.followedTs ? row.followedTs < cutoff : config.unfollow.everyone))
        .sort((a, b) => (a.followedTs || 0) - (b.followedTs || 0));
      const row = pick(due.slice(0, 8));
      if (!row) return 'none';
      try {
        await t.api.unfollow(row.pk, ctx.signal);
      } catch (err) {
        if (err.name !== 'IgError' || err.stop) throw err;
        ctx.log('warn', `Could not unfollow @${row.username}: ${err.message}`);
        return 'skip';
      }
      store.markFollowing(t.owner, row.pk, false);
      store.addEvent(t.owner, 'unfollowed', row);
      ctx.log('info', `Unfollowed @${row.username} (${row.followedTs ? `no follow-back after ${config.unfollow.afterDays} day(s)` : 'does not follow you'}).`);
      return 'done';
    },

    async like() {
      const mine = store.iFollow(t.owner);
      let pk = s.fresh.shift();
      if (!pk) {
        const pool = [
          ...(config.like.following ? mine : []),
          ...(config.like.followers ? [...store.relationships(t.owner, 'fans'), ...store.relationships(t.owner, 'mutual')].map((row) => row.pk) : []),
        ];
        pk = pick(pool);
      }
      const user = pk && store.getUser(pk);
      if (!user) return 'none';
      if (user.isPrivate && !mine.has(pk)) return 'skip';
      let posts;
      try {
        posts = (await t.api.userPosts(user.username, null, ctx.signal)).items;
      } catch (err) {
        if (err.name !== 'IgError' || err.stop) throw err;
        return 'skip';
      }
      const post = posts.sort((a, b) => b.ts - a.ts).find((p) => !p.liked && !s.likedIds.includes(p.id) && Date.now() - p.ts < 120 * DAY);
      if (!post) return 'skip';
      await pause(3, 9); // as if looking at it first
      await t.api.like(post.id, ctx.signal);
      s.likedIds = [...s.likedIds, post.id].slice(-400);
      store.addEvent(t.owner, 'liked', { pk: post.id, username: user.username });
      ctx.log('info', `Liked a post by @${user.username}.`);
      return 'done';
    },
  };

  if (!s.day) ctx.log('info', 'Autopilot is on. It works in short bursts at irregular times and keeps going until you stop it.');
  let snags = 0;
  for (;;) {
    await ctx.checkpoint();
    await rest();
    if (s.day !== today()) newDay();
    try {
      const quiet = inQuietHours();
      if (quiet) {
        await wait(quiet / speed + rand(2, 25) * MIN, 'Quiet hours');
        continue;
      }
      await syncIfDue();

      // One session: a few actions in a row, chosen at random in proportion to what is left of today's plan.
      const size = Math.round(rand(2, 7));
      let acted = 0;
      for (let i = 0; i < size * 2 && acted < size; i++) {
        await ctx.checkpoint();
        const remaining = left();
        const open = KINDS.filter((kind) => remaining[kind] > 0 && !(s.dry[kind] > Date.now() - 45 * MIN * speed));
        if (!open.length) break;
        let roll = Math.random() * open.reduce((sum, kind) => sum + remaining[kind], 0);
        doing = open.find((kind) => (roll -= remaining[kind]) < 0) || open[0];
        const result = await act[doing]();
        if (result === 'none') s.dry[doing] = Date.now();
        if (result === 'done') {
          acted++;
          s.done[doing]++;
        }
        ctx.save();
        show('Working');
        await (doing === 'like' ? pause(8, 40) : pause(20, 75));
      }
      snags = 0;

      const remaining = left();
      const total = KINDS.reduce((sum, kind) => sum + remaining[kind], 0);
      if (!total) {
        await wait(untilTomorrow() + rand(4, 50) * MIN, "Today's plan is done; starting again tomorrow");
      } else if (KINDS.every((kind) => !remaining[kind] || s.dry[kind])) {
        await wait(rand(35, 80) * MIN, 'Nothing to act on right now; checking again later');
      } else {
        // Space the remaining sessions over what is left of the day, never evenly.
        const gap = (untilTomorrow() / (total / 4.5 + 1)) * rand(0.45, 1.6);
        await wait(Math.min(3 * HOUR, Math.max(4 * MIN, gap)), 'Taking a break');
      }
    } catch (err) {
      if (err instanceof Cancelled || ctx.signal.aborted || err.expired || err instanceof HttpError) throw err;
      if (err.blocked) {
        s.blocks = [...s.blocks.filter((ts) => ts > Date.now() - 7 * DAY), Date.now()];
        if (s.blocks.length >= 2) {
          throw new Error('Instagram pushed back twice within a week, so Autopilot has stopped to protect the account. Leave it a few days, then start it again with lower daily numbers.');
        }
        ctx.log('error', 'Instagram pushed back (it asked for a check or blocked an action). Autopilot is doing nothing for a day, then carries on more gently.');
        for (const kind of KINDS) s.plan[kind] = Math.ceil(s.plan[kind] / 2);
        await wait(rand(24, 30) * HOUR, 'Cooling off after Instagram pushed back');
      } else if (err.gone && doing) {
        s.off[doing] = true;
        ctx.log('warn', `Turning off ${NOUN[doing]} for this run: ${err.message}`);
        ctx.save();
      } else {
        if (++snags >= 8) throw err;
        ctx.log('warn', `Hit a snag (${err.message}). Trying again in a few minutes.`);
        await wait(rand(3, 8) * MIN, 'Waiting to retry');
      }
    }
  }
}
