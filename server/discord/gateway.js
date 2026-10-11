import { EventEmitter } from 'node:events';

const DEFAULT_URL = 'wss://gateway.discord.gg';

/**
 * Minimal Discord gateway client (JSON, no compression) with heartbeat, resume and backoff.
 * Emits: 'status' (string), 'dispatch' (type, data), 'fatal' (message).
 */
export class Gateway extends EventEmitter {
  constructor(token) {
    super();
    this.token = token;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.backoff = 1000;
    this.stopped = true;
  }

  connect() {
    this.stopped = false;
    this.#open();
  }

  close() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.emit('status', 'stopped');
  }

  #open() {
    const resuming = Boolean(this.sessionId);
    this.emit('status', resuming ? 'reconnecting' : 'connecting');
    const ws = (this.ws = new WebSocket(`${(resuming && this.resumeUrl) || DEFAULT_URL}/?v=9&encoding=json`));
    ws.onmessage = (event) => this.#onPacket(JSON.parse(event.data));
    ws.onerror = () => {};
    ws.onclose = (event) => {
      clearInterval(this.heartbeat);
      if (this.stopped || ws !== this.ws) return;
      if (event.code === 4004) {
        this.stopped = true;
        this.emit('status', 'stopped');
        this.emit('fatal', 'Discord rejected the token (it may have been reset).');
        return;
      }
      // Codes that invalidate the session and require a fresh identify.
      if ([4007, 4009].includes(event.code)) this.sessionId = null;
      this.emit('status', 'reconnecting');
      this.retryTimer = setTimeout(() => this.#open(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    };
  }

  #send(op, d) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  #beat() {
    if (!this.acked) return this.ws.close(4000); // zombied connection
    this.acked = false;
    this.#send(1, this.seq);
  }

  #onPacket({ op, d, s, t }) {
    if (s) this.seq = s;
    switch (op) {
      case 10: // hello
        this.acked = true;
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => this.#beat(), d.heartbeat_interval);
        if (this.sessionId) {
          this.#send(6, { token: this.token, session_id: this.sessionId, seq: this.seq });
        } else {
          this.#send(2, {
            token: this.token,
            properties: { os: 'Windows', browser: 'Chrome', device: '' },
            // Stay invisible so the logger never changes how your status appears to others.
            presence: { status: 'invisible', since: 0, activities: [], afk: false },
            compress: false,
          });
        }
        break;
      case 11:
        this.acked = true;
        break;
      case 1:
        this.#send(1, this.seq);
        break;
      case 7:
        this.ws.close(4000);
        break;
      case 9:
        if (!d) this.sessionId = null;
        this.ws.close(4000);
        break;
      case 0:
        if (t === 'READY') {
          this.sessionId = d.session_id;
          this.resumeUrl = d.resume_gateway_url;
        }
        if (t === 'READY' || t === 'RESUMED') {
          this.backoff = 1000;
          this.emit('status', 'connected');
        }
        this.emit('dispatch', t, d);
        break;
    }
  }
}
