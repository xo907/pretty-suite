// Demo mode: an in-memory fake Instagram account implementing the same interface as IgClient.
import { IgError } from './client.js';
import { sleep } from '../util.js';

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
const DAY = 86400000;

const FIRST = ['luna', 'milo', 'nova', 'theo', 'iris', 'ezra', 'cleo', 'kai', 'zara', 'remy', 'sage', 'otis', 'wren', 'juno', 'felix', 'opal'];
const TOPIC = ['coffee', 'film', 'trail', 'ceramics', 'vinyl', 'pixel', 'bakes', 'plants', 'surf', 'studio', 'lens', 'yoga', 'code', 'ink'];
const WORDS = ['love this', 'so good', 'where is this?', 'need the recipe', 'obsessed', 'this made my day', 'wow', 'check my page', 'follow for follow?', 'stunning light'];

const ME = { pk: 'd0', username: 'demo.creator', fullName: 'Demo Creator', pic: null, isPrivate: false, isVerified: false, noPic: false };

function makeUser(i) {
  const topic = pick(TOPIC);
  // A spread of archetypes so every filter and score band has someone in it.
  const kind = pick(['friendly', 'friendly', 'friendly', 'big', 'ghost', 'player', 'private', 'dormant']);
  const shape = {
    friendly: { followers: rand(150, 1800), following: rand(400, 2400), posts: rand(12, 300), last: rand(0, 25) },
    big: { followers: rand(40000, 900000), following: rand(80, 700), posts: rand(200, 2000), last: rand(0, 6) },
    ghost: { followers: rand(0, 40), following: rand(900, 6000), posts: 0, last: null },
    player: { followers: rand(6000, 30000), following: rand(60, 500), posts: rand(20, 200), last: rand(0, 14) },
    private: { followers: rand(120, 900), following: rand(150, 1000), posts: rand(5, 120), last: null },
    dormant: { followers: rand(100, 900), following: rand(200, 900), posts: rand(3, 40), last: rand(240, 900) },
  }[kind];
  return {
    pk: `d${1000 + i}`,
    username: `${pick(FIRST)}.${topic}${rand(1, 99)}`,
    fullName: `${pick(FIRST)[0].toUpperCase()}. ${topic}`,
    pic: null,
    isPrivate: kind === 'private',
    isVerified: kind === 'big' && Math.random() < 0.4,
    noPic: kind === 'ghost' || Math.random() < 0.06,
    followers: shape.followers,
    following: shape.following,
    posts: shape.posts,
    bio: `${topic} · ${pick(['daily', 'weekend', 'amateur', 'pro'])} ${pick(TOPIC)} things`,
    lastPostTs: shape.last === null ? null : Date.now() - shape.last * DAY,
  };
}

function buildWorld() {
  const users = Array.from({ length: 260 }, (_, i) => makeUser(i));
  const followers = new Set(users.slice(0, 90).map((u) => u.pk));
  const following = new Set(users.slice(55, 130).map((u) => u.pk));
  let seq = 1;
  const posts = Array.from({ length: 16 }, (_, i) => ({
    id: `dp${i}`,
    code: `DEMO${i}`,
    ts: Date.now() - i * rand(4, 12) * DAY,
    caption: `${pick(TOPIC)} ${pick(['morning', 'mood', 'diary', 'dump'])} #${pick(TOPIC)}`,
    likes: rand(3, 900),
    comments: 0,
    thumb: null,
    owner: ME,
    thread: Array.from({ length: rand(3, 14) }, () => {
      const author = Math.random() < 0.12 ? ME : pick(users);
      return { id: `dc${seq++}`, userId: author.pk, username: author.username, pic: null, text: pick(WORDS), ts: Date.now() - rand(0, 60) * DAY };
    }),
  }));
  const liked = Array.from({ length: 30 }, (_, i) => {
    const owner = pick(users);
    const thread = Array.from({ length: rand(2, 9) }, () => {
      const author = pick(users);
      return { id: `dc${seq++}`, userId: author.pk, username: author.username, pic: null, text: pick(WORDS), ts: Date.now() - rand(0, 200) * DAY };
    });
    if (i % 3 === 0) thread.unshift({ id: `dc${seq++}`, userId: ME.pk, username: ME.username, pic: null, text: pick(WORDS), ts: Date.now() - rand(0, 200) * DAY });
    return { id: `dl${i}`, code: `LIKED${i}`, ts: Date.now() - rand(1, 300) * DAY, caption: `${pick(TOPIC)} notes`, likes: rand(20, 5000), comments: thread.length, thumb: null, owner, thread };
  });
  const threads = Array.from({ length: 9 }, (_, i) => {
    const other = users[i * 7];
    return {
      id: `dt${i}`,
      title: other.username,
      users: [other],
      items: Array.from({ length: rand(6, 40) }, (_, n) => ({
        id: `di${i}-${n}`,
        userId: Math.random() < 0.5 ? ME.pk : other.pk,
        ts: Date.now() - (n * 7 + i) * 3600000 - n,
        type: 'text',
        text: pick(WORDS),
      })),
    };
  });
  return { users, followers, following, posts, liked, threads };
}

const world = buildWorld();
const byPk = new Map(world.users.map((u) => [u.pk, u]));
const basic = ({ pk, username, fullName, pic, isPrivate, isVerified, noPic }) => ({ pk, username, fullName, pic, isPrivate, isVerified, noPic });

function page(list, cursor, size) {
  const start = Number(cursor) || 0;
  return { items: list.slice(start, start + size), next: start + size < list.length ? String(start + size) : null };
}

export class MockIgClient {
  cookies = {};
  #syncs = 0;
  #tick = (signal) => sleep(25, signal);

  async me() {
    return ME;
  }
  async profile(username, signal) {
    await this.#tick(signal);
    if (username === ME.username) {
      return { ...ME, followers: world.followers.size, following: world.following.size, posts: world.posts.length, bio: 'Demo account', lastPostTs: world.posts[0]?.ts ?? null };
    }
    const user = world.users.find((u) => u.username === username);
    if (!user) throw new IgError(`@${username} was not found.`, { status: 404 });
    return { ...user };
  }
  async followers(pk, cursor, signal) {
    await this.#tick(signal);
    // After the first sync the audience drifts a little, so the unfollower tracker has something to show.
    if (pk === ME.pk && !cursor && this.#syncs++ > 0) {
      for (const id of [...world.followers].slice(0, 2)) world.followers.delete(id);
      for (const user of world.users.slice(222 + this.#syncs * 3, 225 + this.#syncs * 3)) world.followers.add(user.pk);
    }
    const set = pk === ME.pk ? [...world.followers] : world.users.slice(130, 200).map((u) => u.pk);
    return page(set.map((id) => basic(byPk.get(id))), cursor, 50);
  }
  async following(pk, cursor, signal) {
    await this.#tick(signal);
    return page([...world.following].map((id) => basic(byPk.get(id))), cursor, 50);
  }
  async follow(pk, signal) {
    await this.#tick(signal);
    world.following.add(pk);
  }
  async unfollow(pk, signal) {
    await this.#tick(signal);
    world.following.delete(pk);
  }
  async searchUsers(keyword, signal) {
    await this.#tick(signal);
    const needle = keyword.toLowerCase();
    const hits = world.users.filter((u) => u.username.includes(needle) || u.bio.includes(needle));
    return (hits.length ? hits : world.users.slice(130, 150)).slice(0, 25).map(basic);
  }
  async hashtagUsers(tag, signal) {
    await this.#tick(signal);
    const needle = tag.replace(/^#/, '').toLowerCase();
    const hits = world.users.filter((u) => u.bio.includes(needle));
    return (hits.length ? hits : world.users.slice(150, 175)).slice(0, 30).map(basic);
  }
  async similar(pk, signal) {
    await this.#tick(signal);
    return world.users.slice(200, 222).map(basic);
  }

  async inbox(cursor, signal) {
    await this.#tick(signal);
    const list = world.threads.map((t) => ({ id: t.id, title: t.title, users: t.users.map(basic), lastTs: t.items[0]?.ts ?? 0, lastText: t.items[0]?.text ?? '' }));
    return page(list, cursor, 5);
  }
  async threadItems(threadId, cursor, signal) {
    await this.#tick(signal);
    // Cursor is a timestamp (like the real API), so unsending items never shifts later pages.
    const older = (world.threads.find((t) => t.id === threadId)?.items || []).filter((i) => !cursor || i.ts < Number(cursor));
    return { items: older.slice(0, 20), next: older.length > 20 ? String(older[19].ts) : null };
  }
  async unsend(threadId, itemId, signal) {
    await this.#tick(signal);
    const thread = world.threads.find((t) => t.id === threadId);
    if (thread) thread.items = thread.items.filter((i) => i.id !== itemId);
  }
  async hideThread(threadId, signal) {
    await this.#tick(signal);
    world.threads = world.threads.filter((t) => t.id !== threadId);
  }

  #strip = ({ thread, ...rest }) => ({ ...rest, comments: thread.length });
  async myPosts(cursor, signal) {
    await this.#tick(signal);
    return page(world.posts.map(this.#strip), cursor, 12);
  }
  async liked(cursor, signal) {
    await this.#tick(signal);
    return page(world.liked.map(this.#strip), cursor, 12);
  }
  async deletePost(id, signal) {
    await this.#tick(signal);
    world.posts = world.posts.filter((p) => p.id !== id);
  }
  archivePost = (id, signal) => this.deletePost(id, signal);
  #likes = new Set();
  async userPosts(username, cursor, signal) {
    await this.#tick(signal);
    const owner = world.users.find((u) => u.username === username);
    const items = Array.from({ length: 3 }, (_, i) => {
      const id = `dp-${username}-${i}`;
      return { id, code: id, ts: Date.now() - (i * 9 + 2) * DAY, caption: `${pick(TOPIC)} notes`, likes: 40 + i, comments: 2, liked: this.#likes.has(id), thumb: null, owner };
    });
    return { items, next: null };
  }
  async like(id, signal) {
    await this.#tick(signal);
    this.#likes.add(id);
  }
  async unlike(id, signal) {
    await this.#tick(signal);
    world.liked = world.liked.filter((p) => p.id !== id);
  }
  async comments(mediaId, cursor, signal) {
    await this.#tick(signal);
    const media = [...world.posts, ...world.liked].find((p) => p.id === mediaId);
    return page(media?.thread || [], cursor, 20);
  }
  async deleteComment(mediaId, commentId, signal) {
    await this.#tick(signal);
    const media = [...world.posts, ...world.liked].find((p) => p.id === mediaId);
    if (media) media.thread = media.thread.filter((c) => c.id !== commentId);
  }
}
