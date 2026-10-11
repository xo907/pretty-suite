// Local copies of Reddit comments and posts: what Archive saves, and what Purge keeps before deleting when the
// safety net is on. Scoped to an owner (the account name) so the demo never mixes with real history.
import { db } from '../db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS reddit_items (
    owner TEXT, name TEXT, kind TEXT, subreddit TEXT, title TEXT, body TEXT, url TEXT, permalink TEXT,
    score INTEGER, ts INTEGER, source TEXT, saved_ts INTEGER, deleted_ts INTEGER, PRIMARY KEY (owner, name)
  );
  CREATE INDEX IF NOT EXISTS idx_reddit_items ON reddit_items (owner, ts);
`);

const upsert = db.prepare(`
  INSERT INTO reddit_items (owner, name, kind, subreddit, title, body, url, permalink, score, ts, source, saved_ts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(owner, name) DO UPDATE SET score = excluded.score, body = CASE WHEN reddit_items.deleted_ts IS NULL THEN excluded.body ELSE reddit_items.body END
`);

/** Returns true when the item was not in the archive before. */
export function saveItem(owner, item, source) {
  const fresh = !db.prepare('SELECT 1 FROM reddit_items WHERE owner = ? AND name = ?').get(owner, item.name);
  upsert.run(owner, item.name, item.kind, item.subreddit ?? null, item.title ?? '', item.body ?? '', item.url ?? null, item.permalink ?? null, item.score ?? 0, item.ts ?? 0, source, Date.now());
  return fresh;
}

export const markDeleted = (owner, name) => db.prepare('UPDATE reddit_items SET deleted_ts = ? WHERE owner = ? AND name = ?').run(Date.now(), owner, name);

function where(owner, q = {}) {
  const parts = ['owner = ?'];
  const args = [owner];
  if (q.kind === 'comment' || q.kind === 'post') (parts.push('kind = ?'), args.push(q.kind));
  if (q.subreddit) (parts.push('subreddit = ? COLLATE NOCASE'), args.push(q.subreddit));
  if (q.deleted === '1') parts.push('deleted_ts IS NOT NULL');
  if (q.q) (parts.push("(body LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"), args.push(...Array(2).fill(`%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`)));
  return { sql: parts.join(' AND '), args };
}

export function listItems(owner, q = {}) {
  const { sql, args } = where(owner, q);
  const limit = Math.min(Number(q.limit) || 100, 500);
  return {
    total: db.prepare(`SELECT COUNT(*) AS n FROM reddit_items WHERE ${sql}`).get(...args).n,
    items: db.prepare(`SELECT * FROM reddit_items WHERE ${sql} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, limit, Number(q.offset) || 0),
  };
}

export const allItems = (owner, q = {}) => {
  const { sql, args } = where(owner, q);
  return db.prepare(`SELECT * FROM reddit_items WHERE ${sql} ORDER BY ts DESC`).all(...args);
};

export function archiveSummary(owner) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(kind = 'comment'), 0) AS comments, COALESCE(SUM(kind = 'post'), 0) AS posts,
              COALESCE(SUM(deleted_ts IS NOT NULL), 0) AS deleted FROM reddit_items WHERE owner = ?`
    )
    .get(owner);
  const subreddits = db.prepare('SELECT subreddit AS name, COUNT(*) AS n FROM reddit_items WHERE owner = ? GROUP BY subreddit ORDER BY n DESC LIMIT 200').all(owner);
  return { ...row, subreddits };
}

export const clearOwner = (owner) => db.prepare('DELETE FROM reddit_items WHERE owner = ?').run(owner);
