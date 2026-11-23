#!/usr/bin/env bash
# Starts BreakShop. Usage: ./start.sh [full|lite]
# Uses the Node.js already on this computer when it is new enough. Asks before downloading anything.
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${1:-full}"
MIN="${BS_MIN_NODE:-22}"
NODE_DIR="$HOME/.breakshop/node/bin"

found_version() { node -p 'process.versions.node' 2>/dev/null || true; }
node_ok() {
  local v major
  v="$(found_version)"
  major="${v%%.*}"
  [ -n "$v" ] && [ "${major:-0}" -ge "$MIN" ]
}

if ! node_ok && [ -x "$NODE_DIR/node" ]; then export PATH="$NODE_DIR:$PATH"; fi

if ! node_ok; then
  have="$(found_version)"
  if [ -n "$have" ]; then
    echo "This computer has Node.js $have, but BreakShop needs Node.js $MIN or newer."
  else
    echo "Node.js was not found on this computer. BreakShop needs Node.js $MIN or newer."
  fi
  if [ "${BS_AUTO_INSTALL_NODE:-}" = "0" ]; then
    echo "Install Node.js from https://nodejs.org and run ./start.sh again."
    exit 1
  fi
  if [ "${BS_AUTO_INSTALL_NODE:-}" != "1" ]; then
    echo "I can download a private copy of Node.js 22 (about 30 MB) into $HOME/.breakshop/node."
    echo "Nothing else on this computer changes, and the Node.js you already have is left alone."
    if [ -t 0 ]; then
      read -r -p "Download it now? [Y/n] " answer
      case "$answer" in n|N) echo "OK. Install Node.js from https://nodejs.org and run ./start.sh again."; exit 1 ;; esac
    else
      echo "Run again with BS_AUTO_INSTALL_NODE=1 to allow the download."
      exit 1
    fi
  fi
  bash "$(pwd)/scripts/install-node.sh" || true
  if [ -x "$NODE_DIR/node" ]; then export PATH="$NODE_DIR:$PATH"; fi
  if ! node_ok; then
    echo "Node.js $MIN or newer is still not available. Install it from https://nodejs.org and run ./start.sh again."
    exit 1
  fi
fi

if [ -n "${BS_DRY_RUN:-}" ]; then
  echo "Using Node.js $(found_version)"
  exit 0
fi

if [ ! -d "node_modules/sqlite3" ]; then
  npm ci --omit=dev
fi

exec node supervisor/index.js --profile "$PROFILE"
