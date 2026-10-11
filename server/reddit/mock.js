// A simulated Reddit account for the demo: enough comments, posts, saved items, votes and communities to try
// every tool without touching a real account.
import { sleep } from '../util.js';

const DAY = 86400000;
const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const SUBS = ['AskReddit', 'programming', 'coffee', 'analog', 'buildapc', 'cooking', 'hiking', 'movies', 'personalfinance', 'gardening', 'vinyl', 'woodworking', 'travel', 'books', 'MechanicalKeyboards', 'houseplants', 'running', 'photography', 'boardgames', 'DIY'];
const LINES = ['Honestly this worked for me after a week.', 'Source? I have seen the opposite.', 'Came here to say this.', 'Underrated advice, thank you.', 'I regret posting this one.', 'This aged badly.', 'Does anyone have a link to the original?', 'Hard disagree, but I see the point.', 'Edit: thanks for all the replies!', 'My old address was in a comment like this once.'];
const TITLES = ['What finally fixed my setup', 'Is this normal? First attempt', 'Looking for recommendations under $100', 'PSA: check your settings', 'A year of progress', 'Unpopular opinion about this hobby'];

export const ME = { id: 'demo', name: 'demo_redditor', icon: null, postKarma: 1840, commentKarma: 12650, created: Date.now() - 6.4 * 365 * DAY };

function buildWorld() {
  let seq = 1000;
  const comment = (author = ME.name) => ({
    name: `t1_d${seq++}`, kind: 'comment', subreddit: pick(SUBS), title: pick(TITLES), body: pick(LINES), url: null, isSelf: true,
    permalink: null, score: rand(-4, 240), ts: Date.now() - rand(1, 2200) * DAY, author, archived: false,
  });
  const post = (author = ME.name) => {
    const isSelf = Math.random() < 0.6;
    return {
      name: `t3_d${seq++}`, kind: 'post', subreddit: pick(SUBS), title: pick(TITLES), body: isSelf ? pick(LINES) : '', url: isSelf ? null : 'https://example.com/picture.jpg', isSelf,
      permalink: null, score: rand(0, 900), ts: Date.now() - rand(1, 2200) * DAY, author, archived: false,
    };
  };
  const byNewest = (list) => list.sort((a, b) => b.ts - a.ts);
  return {
    comments: byNewest(Array.from({ length: 140 }, () => comment())),
    submitted: byNewest(Array.from({ length: 34 }, () => post())),
    saved: Array.from({ length: 45 }, () => (Math.random() < 0.5 ? comment('someone_else') : post('someone_else'))),
    upvoted: Array.from({ length: 80 }, () => post('someone_else')),
    downvoted: Array.from({ length: 12 }, () => post('someone_else')),
    hidden: Array.from({ length: 9 }, () => post('someone_else')),
    communities: SUBS.map((title, i) => ({ name: `t5_d${i}`, title, about: `Everything about ${title}`, members: rand(4000, 4000000), icon: null, isUser: false })),
  };
}

const world = buildWorld();

function page(list, after, size) {
  const start = after ? list.findIndex((item) => item.name === after) + 1 : 0;
  const items = list.slice(start, start + size);
  return { items, next: start + size < list.length && items.length ? items.at(-1).name : null };
}

export class MockRedditClient {
  cookies = {};
  username = ME.name;
  #tick = (signal) => sleep(20, signal);

  async me() {
    return ME;
  }
  async listing(which, { after } = {}, signal) {
    await this.#tick(signal);
    return page(world[which] || [], after, 25);
  }
  async edit(name, text, signal) {
    await this.#tick(signal);
    const item = [...world.comments, ...world.submitted].find((t) => t.name === name);
    if (item) item.body = text;
  }
  async remove(name, signal) {
    await this.#tick(signal);
    world.comments = world.comments.filter((t) => t.name !== name);
    world.submitted = world.submitted.filter((t) => t.name !== name);
  }
  async unsave(name, signal) {
    await this.#tick(signal);
    world.saved = world.saved.filter((t) => t.name !== name);
  }
  async unvote(name, signal) {
    await this.#tick(signal);
    world.upvoted = world.upvoted.filter((t) => t.name !== name);
    world.downvoted = world.downvoted.filter((t) => t.name !== name);
  }
  async unhide(name, signal) {
    await this.#tick(signal);
    world.hidden = world.hidden.filter((t) => t.name !== name);
  }
  async communities(after, signal) {
    await this.#tick(signal);
    return page(world.communities, after, 100);
  }
  async leave(name, signal) {
    await this.#tick(signal);
    world.communities = world.communities.filter((c) => c.name !== name);
  }
}
