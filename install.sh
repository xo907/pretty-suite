#!/usr/bin/env sh
# Sets Pretty Suite up on Linux (or macOS): asks where to keep things, builds it, and can run it as a service.
#
#   ./install.sh                     ask a few questions
#   ./install.sh --yes               take every default (local use only, data in ~/.local/share/PrettySuite)
#   ./install.sh --content /mnt/big/pretty --remote --service
#
# Options: --data DIR  --content DIR  --cache DIR  --port N  --remote  --password TEXT  --service  --yes
set -eu
cd "$(dirname "$0")"

DATA="" CONTENT="" CACHE="" PORT_NUMBER="" REMOTE="" PASSWORD="" SERVICE="" YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data) DATA=$2; shift 2 ;;
    --content) CONTENT=$2; shift 2 ;;
    --cache) CACHE=$2; shift 2 ;;
    --port) PORT_NUMBER=$2; shift 2 ;;
    --password) PASSWORD=$2; REMOTE=yes; shift 2 ;;
    --remote) REMOTE=yes; shift ;;
    --service) SERVICE=yes; shift ;;
    --yes|-y) YES=yes; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
# ask VARIABLE "Question" "default": keeps a value given on the command line, otherwise asks (or takes the default with --yes).
ask() {
  eval "current=\${$1}"
  if [ -n "$current" ]; then return; fi
  if [ -n "$YES" ] || [ ! -r /dev/tty ]; then eval "$1=\$3"; return; fi
  printf '%s [%s]: ' "$2" "$3" > /dev/tty
  read -r answer < /dev/tty || answer=""
  eval "$1=\${answer:-\$3}"
}

if ! command -v node >/dev/null 2>&1; then
  say "Node.js is not installed. Pretty Suite needs Node 22.13 or newer: https://nodejs.org/en/download"
  exit 1
fi
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; then
  say "Node $(node -v) is too old. Pretty Suite needs Node 22.13 or newer: https://nodejs.org/en/download"
  exit 1
fi

DEFAULT_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/PrettySuite"
say ""
say "Pretty Suite keeps three kinds of files. Press Enter to accept a default."
ask DATA    "Database and saved sessions (small)" "$DEFAULT_DATA"
ask CONTENT "Archived attachments (this is what grows; pick the disk with room)" "$DATA/attachments"
ask CACHE   "Cache" "$DATA/login-profiles"
ask PORT_NUMBER "Port" "4477"
ask REMOTE  "Reach it from other machines, with a password? (yes/no)" "no"

HOST_ADDRESS="127.0.0.1"
case "$REMOTE" in
  y|Y|yes|YES|Yes)
    HOST_ADDRESS="0.0.0.0"
    if [ -z "$PASSWORD" ]; then
      PASSWORD=$(node -e 'console.log(require("crypto").randomBytes(15).toString("base64url"))')
      GENERATED=yes
    fi
    ;;
  *) PASSWORD="" ;;
esac

mkdir -p "$DATA" "$CONTENT" "$CACHE"
umask 077
cat > .env <<EOF
# Written by install.sh. Edit and restart Pretty Suite to change anything.
PORT='$PORT_NUMBER'
HOST='$HOST_ADDRESS'
PRETTY_DATA_DIR='$DATA'
PRETTY_CONTENT_DIR='$CONTENT'
PRETTY_CACHE_DIR='$CACHE'
PRETTY_PASSWORD='$PASSWORD'
EOF
umask 022

say ""
say "Installing and building (a minute or two)…"
npm ci --no-audit --no-fund
npm run build

NODE_BIN=$(command -v node)
HERE=$(pwd)
UNIT="[Unit]
Description=Pretty Suite
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$HERE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
RestartSec=5
"

if [ -z "$SERVICE" ] && command -v systemctl >/dev/null 2>&1; then
  ask SERVICE "Start it now and on every boot, as a service? (yes/no)" "no"
fi
case "$SERVICE" in
  y|Y|yes|YES|Yes)
    if [ "$(id -u)" -eq 0 ]; then
      printf '%s\n[Install]\nWantedBy=multi-user.target\n' "$UNIT" > /etc/systemd/system/pretty-suite.service
      systemctl daemon-reload
      systemctl enable --now pretty-suite
      say "Running as a system service. Logs: journalctl -u pretty-suite -f"
    else
      mkdir -p "$HOME/.config/systemd/user"
      printf '%s\n[Install]\nWantedBy=default.target\n' "$UNIT" > "$HOME/.config/systemd/user/pretty-suite.service"
      systemctl --user daemon-reload
      systemctl --user enable --now pretty-suite
      loginctl enable-linger "$(id -un)" 2>/dev/null || say "To keep it running after you log out: sudo loginctl enable-linger $(id -un)"
      say "Running as a service. Logs: journalctl --user -u pretty-suite -f"
    fi
    ;;
  *) say "Start it with:  npm start" ;;
esac

say ""
if [ "$HOST_ADDRESS" = "0.0.0.0" ]; then
  say "Open http://<this machine's address>:$PORT_NUMBER"
  [ -n "${GENERATED:-}" ] && say "Password: $PASSWORD   (also saved in .env)"
  say "That address is plain HTTP. Over the internet, put it behind HTTPS (see README: Remote use)."
else
  say "Open http://localhost:$PORT_NUMBER"
  say "From another computer:  ssh -L $PORT_NUMBER:localhost:$PORT_NUMBER <user>@<this machine>   then open the same address there."
fi
