import { sleep } from '../util.js';

const API = 'https://discord.com/api/v9';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class DiscordError extends Error {
  constructor(status, body) {
    super(body?.message || `Discord responded with HTTP ${status}`);
    this.name = 'DiscordError';
    this.status = status;
    this.code = body?.code;
  }
}

export class RestClient {
  /** `browser`: { userAgent, language } of the browser Pretty Suite is open in, so requests match the user's own setup. */
  constructor(token, browser = {}) {
    this.token = token;
    this.userAgent = browser.userAgent || USER_AGENT;
    this.language = browser.language || 'en-US,en;q=0.9';
    this.rateLimitHits = 0;
  }

  /**
   * query values may be arrays (repeated keys). A 202 from search ("index not ready")
   * is returned as { pending: true, retry_after } for the caller to wait on.
   */
  async request(method, path, { query, body, signal } = {}) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        signal,
        headers: {
          Authorization: this.token,
          'User-Agent': this.userAgent,
          'Accept-Language': this.language,
          Accept: '*/*',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) {
        this.rateLimitHits++;
        const info = await res.json().catch(() => ({}));
        await sleep((info.retry_after ?? 2) * 1000 + 300, signal);
        continue;
      }
      if (res.status >= 500 && attempt < 4) {
        await sleep(1000 * 2 ** attempt, signal);
        continue;
      }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (res.status === 202) return { pending: true, retry_after: data?.retry_after ?? 2 };
      if (!res.ok) throw new DiscordError(res.status, data);
      return data;
    }
  }
}
