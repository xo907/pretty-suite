// Password sign-in, used only when PRETTY_PASSWORD is set (required for remote access).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PASSWORD } from './config.js';
import { getKV, setKV } from './db.js';
import { HttpError } from './util.js';

const COOKIE = 'pretty_session';
const MONTH = 30 * 24 * 60 * 60;
const digest = (value) => createHash('sha256').update(value).digest('hex');
// Only hashes are kept, so the saved list is useless to anyone who reads the database.
let sessions = getKV('auth.sessions', []);
const failures = { count: 0, until: 0 };

export const authRequired = Boolean(PASSWORD);

const cookieOf = (req) => (req.headers.cookie || '').split(';').map((part) => part.trim().split('=')).find(([name]) => name === COOKIE)?.[1];

export function signedIn(req) {
  if (!authRequired) return true;
  const token = cookieOf(req);
  return Boolean(token) && sessions.includes(digest(token));
}

export function signIn(req, res, password) {
  if (Date.now() < failures.until) throw new HttpError(429, 'Too many wrong passwords. Wait a few minutes and try again.');
  const given = Buffer.from(digest(String(password || '')));
  if (!timingSafeEqual(given, Buffer.from(digest(PASSWORD)))) {
    if (++failures.count >= 8) Object.assign(failures, { count: 0, until: Date.now() + 5 * 60 * 1000 });
    throw new HttpError(401, 'Wrong password.');
  }
  failures.count = 0;
  const token = randomBytes(32).toString('hex');
  sessions = [...sessions, digest(token)].slice(-20);
  setKV('auth.sessions', sessions);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MONTH}${secure}`);
  return { ok: true };
}

export function signOut(req, res) {
  const token = cookieOf(req);
  if (token) setKV('auth.sessions', (sessions = sessions.filter((hash) => hash !== digest(token))));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return { ok: true };
}
