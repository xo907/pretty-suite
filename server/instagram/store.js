// Local Instagram data. Everything except the profile cache is scoped to an owner (the connected
// account's pk) so a second account, or the demo, never mixes with your real history.
import { db, getKV, setKV } from '../db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ig_users (
    pk TEXT PRIMARY KEY, username TEXT, full_name TEXT, pic TEXT, is_private INTEGER, is_verified INTEGER, no_pic INTEGER,
    followers INTEGER, following INTEGER, posts INTEGER, bio TEXT, last_post_ts INTEGER, enriched_ts INTEGER
  );
  CREATE TABLE IF NOT EXISTS ig_rel (
    owner TEXT, pk TEXT, follows_me INTEGER DEFAULT 0, i_follow INTEGER DEFAULT 0, PRIMARY KEY (owner, pk)
  );
  CREATE TABLE IF NOT EXISTS ig_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, ts INTEGER, kind TEXT, pk TEXT, username TEXT);
  CREATE INDEX IF NOT EXISTS idx_ig_events ON ig_events (owner, kind, ts);
  CREATE TABLE IF NOT EXISTS ig_queue (
    owner TEXT, list TEXT, pk TEXT, source TEXT, score INTEGER, verdict TEXT, reasons TEXT,
    status TEXT DEFAULT 'pending', added_ts INTEGER, acted_ts INTEGER, PRIMARY KEY (owner, list, pk)
  );
  CREATE TABLE IF NOT EXISTS ig_comments (
    owner TEXT, id TEXT, media_id TEXT, code TEXT, post_owner TEXT, text TEXT, ts INTEGER, PRIMARY KEY (owner, id)
  );
`);

const USER_FIELDS = `u.username, u.full_name AS fullName, u.pic, u.is_private AS isPrivate, u.is_verified AS isVerified, u.no_pic AS noPic,
  u.followers, u.following, u.posts, u.bio, u.last_post_ts AS lastPostTs, u.enriched_ts AS enrichedTs`;

const upsertBasic = db.prepare(`
  INSERT INTO ig_users (pk, username, full_name, pic, is_private, is_verified, no_pic) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(pk) DO UPDATE SET username = excluded.username, full_name = excluded.full_name, pic = excluded.pic,
    is_private = excluded.is_private, is_verified = excluded.is_verified, no_pic = excluded.no_pic
`);
const setEnriched = db.prepare('UPDATE ig_users SET followers = ?, following = ?, posts = ?, bio = ?, last_post_ts = ?, enriched_ts = ? WHERE pk = ?');
const userByPk = db.prepare(`SELECT u.pk, ${USER_FIELDS} FROM ig_users u WHERE u.pk = ?`);

export function saveUser(u) {
  upsertBasic.run(u.pk, u.username, u.fullName ?? '', u.pic ?? null, u.isPrivate ? 1 : 0, u.isVerified ? 1 : 0, u.noPic ? 1 : 0);
  if (u.followers !== undefined) setEnriched.run(u.followers, u.following, u.posts, u.bio ?? '', u.lastPostTs ?? null, Date.now(), u.pk);
}
export const getUser = (pk) => userByPk.get(pk);

// ── Relationships ─────────────────────────────────────────────────────────────────────────────────
const logEvent = db.prepare('INSERT INTO ig_events (owner, ts, kind, pk, username) VALUES (?, ?, ?, ?, ?)');
export const addEvent = (owner, kind, user) => logEvent.run(owner, Date.now(), kind, user.pk, user.username ?? null);

export const eventsSince = (owner, kind, since) =>
  db.prepare('SELECT COUNT(*) AS n FROM ig_events WHERE owner = ? AND kind = ? AND ts >= ?').get(owner, kind, since).n;

export function listEvents(owner, kinds, limit = 200) {
  return db
    .prepare(
      `SELECT e.ts, e.kind, e.pk, COALESCE(u.username, e.username) AS username, u.full_name AS fullName, u.pic
       FROM ig_events e LEFT JOIN ig_users u ON u.pk = e.pk
       WHERE e.owner = ? AND e.kind IN (${kinds.map(() => '?').join(',')}) ORDER BY e.id DESC LIMIT ?`
    )
    .all(owner, ...kinds, limit);
}

/** Replaces the follower/following snapshot and records who was gained or lost since the last one. */
export function saveSnapshot(owner, followers, following) {
  const previous = new Map(db.prepare('SELECT pk, follows_me FROM ig_rel WHERE owner = ?').all(owner).map((r) => [r.pk, r.follows_me]));
  const hadSnapshot = Boolean(getKV(`instagram.synced.${owner}`));
  const insert = db.prepare('INSERT INTO ig_rel (owner, pk, follows_me, i_follow) VALUES (?, ?, ?, ?)');
  let gained = 0;
  let lost = 0;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM ig_rel WHERE owner = ?').run(owner);
    for (const pk of new Set([...followers.keys(), ...following.keys()])) {
      insert.run(owner, pk, followers.has(pk) ? 1 : 0, following.has(pk) ? 1 : 0);
    }
    if (hadSnapshot) {
      for (const [pk, user] of followers) {
        if (!previous.get(pk)) (addEvent(owner, 'gained', user), gained++);
      }
      for (const [pk, wasFollower] of previous) {
        if (wasFollower && !followers.has(pk)) (addEvent(owner, 'lost', getUser(pk) || { pk }), lost++);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  setKV(`instagram.synced.${owner}`, Date.now());
  return { gained, lost };
}

export const lastSynced = (owner) => getKV(`instagram.synced.${owner}`);

const setFollow = db.prepare(`
  INSERT INTO ig_rel (owner, pk, follows_me, i_follow) VALUES (?, ?, 0, ?)
  ON CONFLICT(owner, pk) DO UPDATE SET i_follow = excluded.i_follow
`);
export const markFollowing = (owner, pk, on) => setFollow.run(owner, pk, on ? 1 : 0);

const VIEWS = {
  nonfollowers: 'r.i_follow = 1 AND r.follows_me = 0',
  fans: 'r.follows_me = 1 AND r.i_follow = 0',
  mutual: 'r.follows_me = 1 AND r.i_follow = 1',
};

export function relationships(owner, view) {
  return db
    .prepare(
      `SELECT r.pk, ${USER_FIELDS},
              (SELECT MAX(q.acted_ts) FROM ig_queue q WHERE q.owner = r.owner AND q.pk = r.pk AND q.status = 'followed') AS followedTs
       FROM ig_rel r JOIN ig_users u ON u.pk = r.pk WHERE r.owner = ? AND ${VIEWS[view] || VIEWS.mutual} ORDER BY u.username`
    )
    .all(owner);
}

export function relationshipCounts(owner) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(follows_me), 0) AS followers, COALESCE(SUM(i_follow), 0) AS following,
              COALESCE(SUM(follows_me = 1 AND i_follow = 1), 0) AS mutual,
              COALESCE(SUM(i_follow = 1 AND follows_me = 0), 0) AS nonfollowers,
              COALESCE(SUM(follows_me = 1 AND i_follow = 0), 0) AS fans
       FROM ig_rel WHERE owner = ?`
    )
    .get(owner);
}

/** Everyone this account has unfollowed through Pretty Suite, so they are not followed all over again. */
export const everUnfollowed = (owner) => new Set(db.prepare("SELECT DISTINCT pk FROM ig_events WHERE owner = ? AND kind = 'unfollowed'").all(owner).map((r) => r.pk));

export const iFollow = (owner) => new Set(db.prepare('SELECT pk FROM ig_rel WHERE owner = ? AND i_follow = 1').all(owner).map((r) => r.pk));

// ── Candidate queue (people found by Grow or Follow Back, with a score and a verdict) ─────────────
const queueUpsert = db.prepare(`
  INSERT INTO ig_queue (owner, list, pk, source, score, verdict, reasons, status, added_ts) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  ON CONFLICT(owner, list, pk) DO UPDATE SET source = excluded.source, score = excluded.score, verdict = excluded.verdict,
    reasons = excluded.reasons, status = 'pending', added_ts = excluded.added_ts
`);
export const queueAdd = (owner, list, pk, { source, score, verdict, reasons }) =>
  queueUpsert.run(owner, list, pk, source, score, verdict, JSON.stringify(reasons), Date.now());

export const queueSeen = (owner, list) => new Set(db.prepare('SELECT pk FROM ig_queue WHERE owner = ? AND list = ?').all(owner, list).map((r) => r.pk));

export function queueList(owner, list) {
  return db
    .prepare(
      `SELECT q.pk, q.source, q.score, q.verdict, q.reasons, q.status, ${USER_FIELDS}
       FROM ig_queue q JOIN ig_users u ON u.pk = q.pk
       WHERE q.owner = ? AND q.list = ? AND q.status = 'pending' ORDER BY q.verdict DESC, q.score DESC`
    )
    .all(owner, list)
    .map((row) => ({ ...row, reasons: JSON.parse(row.reasons || '[]') }));
}

export const queueMark = (owner, pk, status) =>
  db.prepare('UPDATE ig_queue SET status = ?, acted_ts = ? WHERE owner = ? AND pk = ? AND status = ?').run(status, Date.now(), owner, pk, 'pending');
export const queueClearPending = (owner, list) => db.prepare("DELETE FROM ig_queue WHERE owner = ? AND list = ? AND status = 'pending'").run(owner, list);

// ── Never-unfollow list ───────────────────────────────────────────────────────────────────────────
export const getWhitelist = (owner) => new Set(getKV(`instagram.whitelist.${owner}`, []));
export function setWhitelisted(owner, pk, on) {
  const list = getWhitelist(owner);
  on ? list.add(pk) : list.delete(pk);
  setKV(`instagram.whitelist.${owner}`, [...list]);
}

// ── My comments found on other people's posts ─────────────────────────────────────────────────────
export const saveFoundComment = (owner, c) =>
  db.prepare('INSERT OR REPLACE INTO ig_comments (owner, id, media_id, code, post_owner, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?)').run(owner, c.id, c.mediaId, c.code ?? null, c.postOwner ?? null, c.text, c.ts);
export const foundComments = (owner) =>
  db.prepare('SELECT id, media_id AS mediaId, code, post_owner AS postOwner, text, ts FROM ig_comments WHERE owner = ? ORDER BY ts DESC').all(owner);
export const dropFoundComment = (owner, id) => db.prepare('DELETE FROM ig_comments WHERE owner = ? AND id = ?').run(owner, id);

export function clearOwner(owner) {
  for (const table of ['ig_rel', 'ig_events', 'ig_queue', 'ig_comments']) db.prepare(`DELETE FROM ${table} WHERE owner = ?`).run(owner);
  setKV(`instagram.synced.${owner}`, null);
  setKV(`instagram.whitelist.${owner}`, null);
}
export const clearDemo = () => (clearOwner('d0'), db.exec("DELETE FROM ig_users WHERE pk LIKE 'd%'"));
