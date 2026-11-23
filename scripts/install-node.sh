#!/usr/bin/env bash
# Installs Node.js 22 for the current user (no admin rights, no package manager) into ~/.breakshop/node.
set -euo pipefail

DEST="$HOME/.breakshop/node"
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) echo "Unsupported system. Install Node.js 22 from https://nodejs.org"; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "Unsupported CPU. Install Node.js 22 from https://nodejs.org"; exit 1 ;;
esac
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is needed to download Node.js. Install Node.js 22 from https://nodejs.org instead."
  exit 1
fi

BASE="https://nodejs.org/dist/latest-v22.x"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Node.js 22 for $OS-$ARCH ..."
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
LINE="$(grep "node-v[0-9.]*-$OS-$ARCH.tar.gz\$" "$TMP/SHASUMS256.txt" | head -n 1)"
[ -n "$LINE" ] || { echo "Could not find a Node.js 22 build for $OS-$ARCH."; exit 1; }
FILE="$(echo "$LINE" | awk '{print $2}')"
WANT="$(echo "$LINE" | awk '{print $1}')"
curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"

if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$TMP/$FILE" | awk '{print $1}')"; else GOT="$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')"; fi
[ "$GOT" = "$WANT" ] || { echo "Download failed its checksum. Nothing was installed."; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$TMP/$FILE" -C "$DEST" --strip-components=1
echo "Node.js installed in $DEST"
