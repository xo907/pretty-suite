export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Cancelled());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DISCORD_EPOCH = 1420070400000n;
export const snowflakeFromMs = (ms) => String((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n);
export const msFromSnowflake = (id) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

/** Accepts an ISO date / datetime-local string and returns ms, or null. */
export function parseDate(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
