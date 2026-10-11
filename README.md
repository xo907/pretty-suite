# Pretty Suite

A self-hosted manager for your own social accounts: Discord, Instagram and Reddit. Bulk-delete what you wrote, keep a
local archive of it, and tidy up who you follow, from one web app that runs on your machine or your server.

Created by [xo.st](https://xo.st).

## Features

**Discord**

- Purge: delete your own messages across DMs, group chats, whole servers or chosen channels, filtered by date, text,
  regex, attachment type and pinned state. Scan first for a count; pause, resume or stop at any time
- Data package import: read your Discord data package (in the browser, never uploaded) to reach closed DMs and see
  which servers you left
- Nuke: one armed switch that purges every open conversation, every imported closed DM and every server
- Archive: save conversations to a local vault, with optional attachment downloads
- Live Logger: records messages as they arrive and keeps the original text of ones later edited or deleted
- Vault and Insights: search, filter and export what was collected (HTML, JSON, CSV, TXT); activity charts

**Instagram**

- Autopilot: follows good matches, unfollows people who did not follow back after a set number of days, and likes
  recent posts, in short sessions at irregular times against a daily plan
- Grow and Follow Back: find accounts by keyword, hashtag or another account's followers, each scored 0–100 for how
  likely they are to follow back
- Audience: who does not follow back, mutuals and fans; bulk unfollow with a never-unfollow list; follower changes
  between syncs
- Messages: unsend your messages and remove conversations
- Content: bulk delete posts and comments

**Reddit**

- Purge: delete your comments and posts, filtered by community, date, score, text or regex, with optional overwrite
  before deleting
- Activity: unsave everything, withdraw votes, unhide posts
- Communities: leave in bulk
- Archive: a local, searchable copy of your comments and posts, exportable as CSV or JSON

**Everywhere**

- Every job shows the time left, saves its place after each step, and carries on after a restart
- Actions are paced like a person's: uneven gaps, a drifting tempo, a short break now and then
- A demo account for each platform, for trying things without connecting
- You choose where the database, the archived attachments and the cache are stored

## Quick start

You need git. The installer takes care of the rest: if Node.js 22.13 or newer is not there, it offers to install it
(the official build from nodejs.org on Linux, winget on Windows).

**Linux**

```bash
git clone https://github.com/xo907/pretty-suite.git
cd pretty-suite
./install.sh
```

**Windows** (PowerShell)

```powershell
git clone https://github.com/xo907/pretty-suite.git
cd pretty-suite
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer asks where to keep things, builds the app, and offers to run it in the background (a systemd service on
Linux, a log-in task on Windows). Then open http://localhost:4477.

To skip the questions, pass the answers: `./install.sh --content /mnt/big/pretty --remote --service`, or
`.\install.ps1 -ContentDir D:\PrettySuite -Autostart`. `--yes` / `-Yes` takes every default.

**Docker**

Copy `docker-compose.example.yml` to `docker-compose.yml`, set the content path and the password, then
`docker compose up -d --build`.

## Where things are stored

| What | Setting | Default |
| --- | --- | --- |
| Database, saved sessions, settings (small) | `PRETTY_DATA_DIR` | `%LOCALAPPDATA%\PrettySuite`, or `~/.local/share/PrettySuite` |
| Archived attachments (this is what grows) | `PRETTY_CONTENT_DIR` | `<data>/attachments` |
| Cache (the separate login window's browser profile) | `PRETTY_CACHE_DIR` | `<data>/login-profiles` |

The installer writes these to `.env`; `.env.example` lists every setting. To move a folder later, change the setting,
move the folder, and restart. Settings in the app shows the three paths in use.

## Remote use

Pretty Suite holds the keys to your accounts, so by default it only answers on the machine it runs on. Two ways to use
it from elsewhere:

**An SSH tunnel (simplest, nothing exposed).** Leave the defaults and, on your own computer, run

```bash
ssh -L 4477:localhost:4477 you@your-server
```

then open http://localhost:4477 there.

**A password.** Install with `--remote` (or set `HOST='0.0.0.0'` and `PRETTY_PASSWORD`). The app then asks for the
password before showing anything, and refuses to start if one is not set. That address is plain HTTP, so over the
internet put it behind a reverse proxy with HTTPS. With Caddy:

```
suite.example.com {
    reverse_proxy localhost:4477
}
```

Things to know on a server:

- There is no browser on it for "Log in with this browser". Connect Instagram and Reddit by pasting the session cookie
  from your own browser; Discord by token, as usual.
- Instagram and Reddit distrust data-centre addresses. Expect more checks and blocks from a VPS than from home, and
  keep the daily numbers low.

## Connecting accounts

- **Discord**: your user token.
- **Instagram and Reddit**: log in on the real site in the browser you already have open (it needs "Allow remote
  debugging for this browser instance" ticked at `chrome://inspect/#remote-debugging`), in a separate window, or by
  pasting the session cookie. Your password is typed into the real site and never passes through Pretty Suite.

## Development

```bash
npm install
npm run dev
```

- `server/`: HTTP API, job runner, and one folder per platform. No runtime dependencies (built-in SQLite, WebSocket
  and fetch)
- `web/`: React and Tailwind UI, built with Vite

## A note on risk

Pretty Suite acts with your own login. Automating a personal account is against the terms of service of Discord,
Instagram and Reddit and can lead to action against the account. Requests are paced and limits are respected, but how
much you do in a day is what platforms act on. Use it knowingly.

Instagram and Reddit change their private endpoints without notice, so features there can stop working until the app
is updated. The Reddit side has so far only been run against the built-in demo account.
