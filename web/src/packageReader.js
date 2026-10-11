// Reads a Discord data package (the zip, or an unzipped folder) entirely in the browser,
// pulling out only the message list, and hands it to the local server in small chunks.
import { BlobReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js';
import { api } from './api.js';

configure({ useWebWorkers: false });

const CHANNEL_FILE = /(?:^|\/)messages\/c?(\d+)\/(channel\.json|messages\.json|messages\.csv)$/i;
const INDEX_FILE = /(?:^|\/)messages\/index\.json$/i;
const USER_FILE = /(?:^|\/)account\/user\.json$/i;
const CHUNK_CHARS = 1_500_000;

/** Normalises a zip file or a picked folder into [{ path, text() }]. */
async function listEntries(files) {
  const zip = files.length === 1 && /\.zip$/i.test(files[0].name) ? files[0] : null;
  if (!zip) return files.map((file) => ({ path: file.webkitRelativePath || file.name, text: () => file.text() }));
  const entries = await new ZipReader(new BlobReader(zip)).getEntries();
  return entries
    .filter((e) => !e.directory)
    .map((e) => ({ path: e.filename.replace(/\\/g, '/'), text: () => e.getData(new TextWriter()) }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (row.push(cell), (cell = ''));
    else if (ch === '\n') (row.push(cell), rows.push(row), (row = []), (cell = ''));
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows;
}

function parseMessages(text, isCsv) {
  if (isCsv) {
    return parseCsv(text).slice(1).map(([id, , content, attachments]) => ({ id, content: content || '', attachments: attachments || '' }));
  }
  // Message IDs are written as bare numbers too large for JavaScript; quote them before parsing.
  const list = JSON.parse(text.replace(/"ID":\s*(\d+)/g, '"ID":"$1"'));
  return list.map((m) => ({ id: String(m.ID), content: m.Contents || '', attachments: m.Attachments || '' }));
}

const kindOf = (type) => (type === 1 || type === 'DM' ? 'dm' : type === 3 || type === 'GROUP_DM' ? 'group' : 'guild');

/**
 * @param {File[]} files  one .zip, or every file of an unzipped package folder
 * @param {(done: number, total: number) => void} onProgress
 * @returns the server's summary of what was imported
 */
export async function importPackage(files, onProgress) {
  const entries = await listEntries(files);
  const channels = new Map();
  for (const entry of entries) {
    const match = entry.path.match(CHANNEL_FILE);
    if (!match) continue;
    const slot = channels.get(match[1]) || {};
    slot[match[2].toLowerCase()] = entry;
    channels.set(match[1], slot);
  }
  if (!channels.size) {
    throw new Error('That does not look like a Discord data package — no "messages" folder was found inside it.');
  }

  const indexEntry = entries.find((e) => INDEX_FILE.test(e.path));
  const index = indexEntry ? JSON.parse(await indexEntry.text()) : {};
  const userEntry = entries.find((e) => USER_FILE.test(e.path));
  const userId = userEntry ? JSON.parse(await userEntry.text()).id : null;

  await api.post('/api/discord/package/begin', { userId });

  let batch = [];
  let size = 0;
  let done = 0;
  const flush = async () => {
    if (batch.length) await api.post('/api/discord/package/chunk', { channels: batch });
    batch = [];
    size = 0;
  };

  for (const [id, slot] of channels) {
    const messageEntry = slot['messages.json'] || slot['messages.csv'];
    if (messageEntry) {
      const info = slot['channel.json'] ? JSON.parse(await slot['channel.json'].text()) : {};
      const text = await messageEntry.text();
      const messages = parseMessages(text, messageEntry === slot['messages.csv']);
      const kind = kindOf(info.type);
      const label = index[id] || '';
      batch.push({
        id,
        kind,
        name: kind === 'guild' ? info.name || label.replace(/ in .*$/, '') : info.name || label.replace(/^Direct Message with /i, ''),
        guildId: info.guild?.id,
        guildName: info.guild?.name,
        recipients: info.recipients || [],
        messages,
      });
      size += text.length;
      if (size > CHUNK_CHARS) await flush();
    }
    onProgress(++done, channels.size);
  }
  await flush();
  return api.post('/api/discord/package/finish');
}
