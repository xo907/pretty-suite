// Where things live and how the app is reached. Settings come from the environment, which a .env file next to
// package.json fills in (see .env.example). Nothing here needs editing by hand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const folder = (value) => path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir()));
const local = env.LOCALAPPDATA || env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');

/** Database, saved sessions and settings. Small; kept off synced folders so tokens stay on this machine. */
export const dataDir = folder(env.PRETTY_DATA_DIR || path.join(local, 'PrettySuite'));
/** Archived attachments: the part that grows. Point it at the disk with room. */
export const contentDir = folder(env.PRETTY_CONTENT_DIR || path.join(dataDir, 'attachments'));
/** Throwaway files, such as the browser profile used by the separate login window. */
export const cacheDir = folder(env.PRETTY_CACHE_DIR || path.join(dataDir, 'login-profiles'));
for (const dir of [dataDir, contentDir, cacheDir]) fs.mkdirSync(dir, { recursive: true });

export const PORT = Number(env.PORT) || 4477;
export const HOST = env.HOST || '127.0.0.1';
export const PASSWORD = env.PRETTY_PASSWORD || '';
/** True when the app can be reached from other machines, which changes what is safe and what is possible. */
export const remote = !['127.0.0.1', 'localhost', '::1'].includes(HOST);

if (remote && PASSWORD.length < 8) {
  console.error(
    `\n  Refusing to start: HOST is ${HOST}, which makes Pretty Suite reachable from other machines, but PRETTY_PASSWORD\n` +
      '  is not set (or is shorter than 8 characters). It holds the keys to your accounts, so it will not run open.\n' +
      '  Set PRETTY_PASSWORD in .env, or leave HOST at 127.0.0.1 and reach it through an SSH tunnel.\n'
  );
  process.exit(1);
}
