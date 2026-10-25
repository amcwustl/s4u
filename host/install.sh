#!/bin/bash
# Builds the native host and registers it with Chrome for this extension's pinned ID.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
mkdir -p host/bin
swiftc -O host/spotify-host.swift -o host/bin/spotify-host

# Extension ID = first 32 hex chars of SHA-256 of the DER public key, mapped 0-9a-f → a-p.
KEY=$(python3 -c 'import json,sys; print(json.load(open("ext/manifest.json"))["key"])')
ID=$(echo "$KEY" | openssl base64 -d -A | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p')

DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DIR"
cat > "$DIR/com.s4u.spotify_host.json" <<JSON
{
  "name": "com.s4u.spotify_host",
  "description": "Commercial Switcher Spotify controller",
  "path": "$ROOT/host/bin/spotify-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
echo "Installed host manifest for extension ID: $ID"
echo "Binary: $ROOT/host/bin/spotify-host"
