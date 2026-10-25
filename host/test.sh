#!/bin/bash
# Protocol tests for the native host using a fake osascript/open on PATH.
set -u
cd "$(dirname "$0")/.."
BIN=host/bin/spotify-host
mkdir -p host/bin
swiftc -O host/spotify-host.swift -o "$BIN" 2>&1 || { echo "BUILD FAILED"; exit 1; }

TMP=$(mktemp -d)
export FAKE_LOG="$TMP/log"
export FAKE_RUNNING_FILE="$TMP/running"
fails=0
pass() { echo "ok - $1"; }
fail() { echo "not ok - $1"; fails=$((fails+1)); }

# frame JSON messages with 4-byte LE length prefixes
frame() { node -e '
  const bufs = process.argv.slice(1).map(s => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); });
  process.stdout.write(Buffer.concat(bufs));' "$@"; }
# unframe replies → one JSON per line
unframe() { node -e '
  const chunks = []; process.stdin.on("data", c => chunks.push(c)); process.stdin.on("end", () => {
    let b = Buffer.concat(chunks), off = 0;
    while (off + 4 <= b.length) { const l = b.readUInt32LE(off); console.log(b.subarray(off + 4, off + 4 + l).toString("utf8")); off += 4 + l; } });'; }
run() { : > "$FAKE_LOG"; frame "$@" | PATH="$PWD/host/fake-bin:$PATH" "$BIN" | unframe; }
has() { node -e 'const r=JSON.parse(process.argv[1]); process.exit(eval(process.argv[2]) ? 0 : 1)' "$1" "$2"; }

export FAKE_RUNNING=true
r=$(run '{"cmd":"status"}')
has "$r" 'r.ok===true && r.running===true && r.state==="paused" && r.track==="Fake Track"' && pass "status" || fail "status: $r"

r=$(run '{"cmd":"commercial"}')
grep -q 'tell application "Spotify" to play' "$FAKE_LOG" && has "$r" 'r.ok===true' && pass "commercial plays" || fail "commercial: $r $(cat $FAKE_LOG)"

r=$(run '{"cmd":"game"}')
grep -q 'to pause' "$FAKE_LOG" && has "$r" 'r.ok===true' && pass "game pauses" || fail "game: $r"

r=$(run '{"cmd":"play_uri","uri":"spotify:playlist:abc"}')
grep -q 'play track "spotify:playlist:abc"' "$FAKE_LOG" && pass "play_uri" || fail "play_uri: $(cat $FAKE_LOG)"

# Spotify not running: fake osascript answers from FAKE_RUNNING_FILE if present
export FAKE_RUNNING=false; rm -f "$FAKE_RUNNING_FILE"
r=$(FAKE_RUNNING_FILE="$FAKE_RUNNING_FILE" run '{"cmd":"commercial"}')
if grep -q 'open -gj -a Spotify' "$FAKE_LOG" && has "$r" 'r.ok===true'; then
  openLine=$(grep -n 'open -gj' "$FAKE_LOG" | head -1 | cut -d: -f1); playLine=$(grep -n 'to play' "$FAKE_LOG" | head -1 | cut -d: -f1)
  [ "$openLine" -lt "$playLine" ] && pass "launches Spotify before play" || fail "open after play"
else fail "launch: $r $(cat $FAKE_LOG)"; fi
export FAKE_RUNNING=false; rm -f "$FAKE_RUNNING_FILE"
r=$(run '{"cmd":"commercial","launch":false}')
! grep -q 'open -gj' "$FAKE_LOG" && has "$r" 'r.ok===true && r.running===false' && pass "launch:false does not open Spotify" || fail "launch:false: $r $(cat $FAKE_LOG)"
export FAKE_RUNNING=true

r=$(run '{"cmd":"bogus"}')
has "$r" 'r.ok===false && r.error==="unknown cmd"' && pass "unknown cmd" || fail "unknown: $r"

r=$(run '{"cmd":"status"}' '{"cmd":"game"}')
[ "$(echo "$r" | wc -l | tr -d ' ')" = "2" ] && pass "two messages, two framed replies" || fail "framing: $r"

rm -rf "$TMP"
echo "# fails: $fails"; exit $fails
