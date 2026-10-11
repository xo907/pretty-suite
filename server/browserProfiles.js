// Detects the Chromium-family browsers installed for this user and the profiles inside each one,
// so the login window can be launched from the browser the user is already signed in on.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const home = env.HOME || env.USERPROFILE || '';

/** Candidate install locations per browser, by platform. First existing exe wins. */
function browserDefs() {
  if (process.platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      { id: 'edge', name: 'Microsoft Edge', exes: roots.map((r) => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')), userData: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { id: 'chrome', name: 'Google Chrome', exes: roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')), userData: path.join(local, 'Google', 'Chrome', 'User Data') },
      { id: 'brave', name: 'Brave', exes: roots.map((r) => path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')), userData: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { id: 'chromium', name: 'Chromium', exes: roots.map((r) => path.join(r, 'Chromium', 'Application', 'chrome.exe')), userData: path.join(local, 'Chromium', 'User Data') },
    ];
  }
  if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    return [
      { id: 'chrome', name: 'Google Chrome', exes: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], userData: path.join(support, 'Google', 'Chrome') },
      { id: 'edge', name: 'Microsoft Edge', exes: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'], userData: path.join(support, 'Microsoft Edge') },
      { id: 'brave', name: 'Brave', exes: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'], userData: path.join(support, 'BraveSoftware', 'Brave-Browser') },
      { id: 'chromium', name: 'Chromium', exes: ['/Applications/Chromium.app/Contents/MacOS/Chromium'], userData: path.join(support, 'Chromium') },
    ];
  }
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    { id: 'chrome', name: 'Google Chrome', exes: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'], userData: path.join(config, 'google-chrome') },
    { id: 'chromium', name: 'Chromium', exes: ['/usr/bin/chromium', '/usr/bin/chromium-browser'], userData: path.join(config, 'chromium') },
    { id: 'edge', name: 'Microsoft Edge', exes: ['/usr/bin/microsoft-edge'], userData: path.join(config, 'microsoft-edge') },
    { id: 'brave', name: 'Brave', exes: ['/usr/bin/brave-browser'], userData: path.join(config, 'BraveSoftware', 'Brave-Browser') },
  ];
}

/** The browser Windows opens links with, when it is one of the above. */
function defaultBrowserId() {
  if (process.platform !== 'win32') return null;
  try {
    const query = (...args) => execFileSync('reg', ['query', ...args], { encoding: 'utf8', windowsHide: true });
    const progId = /ProgId\s+REG_SZ\s+(\S+)/.exec(query('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'))[1];
    const command = query(`HKCR\\${progId}\\shell\\open\\command`, '/ve').toLowerCase();
    return browserDefs().find((b) => b.exes.some((exe) => command.includes(exe.toLowerCase())))?.id ?? null;
  } catch {
    return null;
  }
}

/** Installed browsers as { id, name, exe, userData }, the user's default one first. */
export function installedBrowsers() {
  const preferred = defaultBrowserId();
  return browserDefs()
    .map((def) => ({ id: def.id, name: def.name, exe: def.exes.find((exe) => fs.existsSync(exe)), userData: def.userData }))
    .filter((b) => b.exe)
    .sort((a, b) => (b.id === preferred) - (a.id === preferred));
}

/** Reads the friendly profile names ("Person 1", an email, …) Chromium stores in Local State. */
function readProfiles(userData) {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf8'))?.profile?.info_cache || {};
  } catch {
    // No Local State yet — fall back to scanning for profile folders below.
  }
  const dirs = Object.keys(cache);
  if (!dirs.length) {
    for (const entry of fs.readdirSync(userData, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name === 'Default' || /^Profile \d+$/.test(entry.name))) dirs.push(entry.name);
    }
  }
  return dirs
    .filter((dir) => fs.existsSync(path.join(userData, dir)))
    .map((dir) => ({ dir, label: cache[dir]?.name || (dir === 'Default' ? 'Default' : dir) }));
}

/** A running Chromium holds an exclusive lock on its cookie DB, so this doubles as "is the browser open?". */
export function profileLocked(userData, profileDir) {
  for (const rel of [['Network', 'Cookies'], ['Cookies']]) {
    const file = path.join(userData, profileDir, ...rel);
    if (!fs.existsSync(file)) continue;
    try {
      fs.closeSync(fs.openSync(file, 'r'));
      return false;
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EACCES' || err.code === 'EPERM') return true;
      return false;
    }
  }
  return false;
}

export function findBrowserExe(id) {
  const def = browserDefs().find((b) => b.id === id);
  return def?.exes.find((exe) => fs.existsSync(exe));
}

export function browserUserData(id) {
  return browserDefs().find((b) => b.id === id)?.userData;
}

/** Everything the UI needs: which browsers exist and the profiles in each. */
export function detectBrowsers() {
  const found = [];
  for (const def of browserDefs()) {
    const exe = def.exes.find((e) => fs.existsSync(e));
    if (!exe || !fs.existsSync(def.userData)) continue;
    let profiles = [];
    try {
      profiles = readProfiles(def.userData);
    } catch {
      profiles = [{ dir: 'Default', label: 'Default' }];
    }
    if (profiles.length) found.push({ id: def.id, name: def.name, running: profiles.some((p) => profileLocked(def.userData, p.dir)), profiles });
  }
  return found;
}
