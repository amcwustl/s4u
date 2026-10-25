# Commercial Switcher

Mutes a live sports tab in Chrome during commercial breaks and plays the Spotify desktop app instead.
Detection runs locally in the browser: the learned scoreboard graphic, the broadcast's own sound
(YAMNet embeddings), and black cuts. A tiny Swift helper drives Spotify via AppleScript.

Design: `docs/superpowers/specs/2026-10-25-commercial-switcher-design.md`.

## Install (macOS, Chrome)

```bash
bash host/install.sh          # builds the Spotify helper and registers it with Chrome
```

1. `chrome://extensions` → Developer mode → **Load unpacked** → pick the `ext/` folder.
   The ID must match the one `host/install.sh` printed (`kogicdpnpkknffcmplelmolfifhfpjib`).
2. Pin the icon.

## Game day

1. Open the stream, start playback (fullscreen is fine), click the extension icon. Badge: **ON**.
   Do this while the game is on, not during a break: the first 45 s teach it what the game sounds like.
2. ~30 s later the on-screen badge says **Game** (scoreboard learned). From then on it switches by itself.
3. Click the icon again to turn it off completely.

| Key | Action |
|---|---|
| `Option+Shift+M` | Mute/unmute now (overrides the current decision) |
| `Option+Shift+P` | Pause/resume automatic switching |

**Shadow mode is on by default.** It detects and logs but never mutes or touches Spotify, so the
first run is a dry run. Right-click the icon → **Open debug panel** to watch the signals, then untick
*Shadow mode* there (or in Settings) to go live.

## Tuning

- Debug panel → **Export log** saves a JSON of every second. Mark breaks with **A** / **G** while
  watching to score it: `node tools/replay.mjs <log.json> --set goneSec=5`.
- `tools/tab-recorder.html` records a tab (video + audio) to `.webm`; `tools/prep-fixture.sh`
  turns it into fixture files; `tools/fixture-player.html` runs the whole pipeline over them.

## Develop

```bash
npm test              # pure detection modules (node --test)
bash host/test.sh     # native host protocol tests with a fake osascript
python3 -m http.server 8765   # then open tools/audio-selftest.html or tools/fixture-player.html
```
