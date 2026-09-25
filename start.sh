#!/usr/bin/env bash
# ChainLock + SENTINEL — one-command launcher for Linux and macOS.
#
#   From anywhere (downloads everything):
#     curl -fsSL https://raw.githubusercontent.com/aryansingh32/chainlock-sentinel/main/start.sh | bash
#   Inside a checkout:
#     ./start.sh
#
# What it does:
#   1. Gets the code (if not already inside the repo) — no git needed.
#   2. Uses your Node.js >= 20.19, or downloads a portable Node 22 into .tools/ (no sudo).
#   3. Installs web dependencies (npm).
#   4. Creates backend/.venv and installs the Python Crypto Core (real ML-DSA / ML-KEM / SLH-DSA).
#      No Python 3.10+? The app still runs, with simulated signatures.
#   5. Starts the Crypto Core on :8000 and the web app on :5173, then opens your browser.
#   Ctrl+C stops everything.
#
# Options (environment variables): WEB_PORT=5173 API_PORT=8000 NO_BACKEND=1 NO_BROWSER=1 INSTALL_DIR=./chainlock-sentinel
set -euo pipefail

REPO="aryansingh32/chainlock-sentinel"
BRANCH="${BRANCH:-main}"
NODE_VERSION="${NODE_VERSION:-22.22.2}"
WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-8000}"

say() { printf '\033[1;34m[chainlock]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[chainlock]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[chainlock]\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # fetch URL OUTFILE
  if have curl; then curl -fsSL "$1" -o "$2"; elif have wget; then wget -qO "$2" "$1"; else die "Need curl or wget to download $1"; fi
}

# ---------------------------------------------------------------- 1. code
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ] && [ -d "$SCRIPT_DIR/backend" ]; then
  ROOT="$SCRIPT_DIR"
else
  ROOT="${INSTALL_DIR:-$PWD/chainlock-sentinel}"
  if [ -f "$ROOT/package.json" ]; then
    say "Using existing copy in $ROOT"
  else
    say "Downloading $REPO ($BRANCH) into $ROOT"
    mkdir -p "$ROOT"
    tmp="$(mktemp -d)"
    fetch "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" "$tmp/src.tar.gz"
    tar -xzf "$tmp/src.tar.gz" -C "$ROOT" --strip-components=1
    rm -rf "$tmp"
  fi
fi
cd "$ROOT"
say "Project: $ROOT"

# ---------------------------------------------------------------- 2. Node.js
node_ok() {
  have node || return 1
  local v; v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  local major="${v%%.*}" rest="${v#*.}"; local minor="${rest%%.*}"
  # Vite 8 needs Node ^20.19 or >= 22.12
  [ "$major" -ge 23 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; } || { [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; }
}
if [ -x "$ROOT/.tools/node/bin/node" ]; then export PATH="$ROOT/.tools/node/bin:$PATH"; fi
if ! node_ok; then
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in Linux) plat=linux ext=tar.xz ;; Darwin) plat=darwin ext=tar.gz ;; *) die "Unsupported OS $os — on Windows use start.bat" ;; esac
  case "$arch" in x86_64|amd64) a=x64 ;; aarch64|arm64) a=arm64 ;; armv7l) a=armv7l ;; *) die "Unsupported CPU $arch" ;; esac
  name="node-v$NODE_VERSION-$plat-$a"
  say "Node.js >= 20.19 not found — downloading portable $name (no admin rights needed)"
  mkdir -p .tools
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$name.$ext" ".tools/node.$ext"
  rm -rf .tools/node && mkdir -p .tools/node
  tar -xf ".tools/node.$ext" -C .tools/node --strip-components=1
  rm -f ".tools/node.$ext"
  export PATH="$ROOT/.tools/node/bin:$PATH"
  node_ok || die "Portable Node failed to start"
fi
say "Node $(node -v) · npm $(npm -v)"

# ---------------------------------------------------------------- 3. web deps
if [ ! -x node_modules/.bin/vite ] || [ package.json -nt node_modules/.chainlock-installed ]; then
  say "Installing web dependencies (first run takes a minute)…"
  npm install --no-fund --no-audit --loglevel=error
  touch node_modules/.chainlock-installed
else
  say "Web dependencies already installed"
fi

# ---------------------------------------------------------------- 4. Python Crypto Core
BACKEND_PID=""
if [ "${NO_BACKEND:-0}" != "1" ]; then
  PY=""
  for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if have "$c" && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then PY="$c"; break; fi
  done
  if [ -z "$PY" ]; then
    warn "Python 3.10+ not found. Install it for real post-quantum signatures:"
    warn "  Ubuntu/Debian: sudo apt install python3 python3-venv   ·   Fedora: sudo dnf install python3   ·   macOS: brew install python"
    warn "Continuing in SIMULATED crypto mode."
  else
    VENV="backend/.venv"
    if [ ! -x "$VENV/bin/python" ]; then
      say "Creating Python virtual environment ($($PY --version))"
      if ! "$PY" -m venv "$VENV" 2>/dev/null; then
        rm -rf "$VENV"
        warn "python venv module missing (Debian/Ubuntu: sudo apt install python3-venv). Continuing in SIMULATED mode."
        PY=""
      fi
    fi
    if [ -n "$PY" ]; then
      if [ ! -f "$VENV/.installed" ] || [ backend/requirements.txt -nt "$VENV/.installed" ]; then
        say "Installing Crypto Core packages…"
        "$VENV/bin/python" -m pip install -q --upgrade pip
        "$VENV/bin/python" -m pip install -q -r backend/requirements.txt
        touch "$VENV/.installed"
      fi
      say "Starting Crypto Core on http://127.0.0.1:$API_PORT (docs at /docs)"
      (cd backend && exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "$API_PORT" --log-level warning) &
      BACKEND_PID=$!
    fi
  fi
fi

cleanup() {
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 5. web app
say "Starting web app on http://localhost:$WEB_PORT"
VITE_CRYPTO_CORE_URL="http://127.0.0.1:$API_PORT" npx vite dev --host 127.0.0.1 --port "$WEB_PORT" --strictPort &
WEB_PID=$!

URL="http://localhost:$WEB_PORT/"
for _ in $(seq 1 120); do
  kill -0 "$WEB_PID" 2>/dev/null || die "Web app failed to start (is port $WEB_PORT in use? try WEB_PORT=5174)"
  if have curl; then curl -fs -o /dev/null "http://127.0.0.1:$WEB_PORT/" && break; else sleep 8 && break; fi
  sleep 1
done

cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
    ChainLock + SENTINEL is running
    Web app      : $URL
    Crypto Core  : $([ -n "$BACKEND_PID" ] && echo "http://127.0.0.1:$API_PORT/docs  (LIVE post-quantum crypto)" || echo "not running — SIMULATED signatures")
    Demo panel   : press D in the app · Jury script: Briefing page
    Stop         : Ctrl+C
  └──────────────────────────────────────────────────────────────┘

EOF

if [ "${NO_BROWSER:-0}" != "1" ]; then
  if have xdg-open; then xdg-open "$URL" >/dev/null 2>&1 || true; elif have open; then open "$URL" || true; fi
fi

wait "$WEB_PID"
