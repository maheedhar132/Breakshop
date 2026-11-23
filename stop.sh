#!/usr/bin/env bash
# Stops BreakShop.
set -euo pipefail
cd "$(dirname "$0")"
NODE_DIR="$HOME/.breakshop/node/bin"
[ -x "$NODE_DIR/node" ] && export PATH="$NODE_DIR:$PATH"
exec node supervisor/stop.js
