# Commercial Switcher — Design

**Date:** 2026-10-25
**Status:** Draft for approval
**Working name:** Commercial Switcher (project dir `s4u`)

## 1. Intent

Aaron watches NFL games in Chrome on a Mac through a streaming service called
seasons4u. He wants to hear the game and never hear the commercials. When a
commercial break starts, the game tab should go silent and the Spotify desktop
app should start playing. When the game comes back, Spotify should pause and
the game audio should return. He should not have to touch anything during the
game beyond starting the tool once.

The thing that makes this hard is telling a commercial apart from the many
moments in a broadcast that *look* like one: long replays, close-ups with no
field visible, sideline interviews, stat graphics, and the halftime show.
Aaron's specific worry is that long replays will trigger a false switch.

### Why this design

Prior art (see §10) showed that the most reliable discriminator is **whether
the audio still sounds like this broadcast**. Crowd noise, venue ambience, and
the announcers persist through replays, close-ups, and halftime; a commercial
sounds different within seconds. A persistent on-screen scoreboard is the
cheapest and fastest "game is on" signal. Black frames plus silence appear only
at break boundaries. Combining these three, with asymmetric rules for entering
and leaving the commercial state, is the approach this document specifies.

Field-color (green percentage) detection was considered and rejected: the audio
signal solves the replay problem it was meant to solve, and green fails on
close-ups (no green during play) and on lawn-care, beer, and golf ads (green
during commercials).

## 2. Goals

- During a commercial break, the game tab is silent and Spotify is playing.
- During game action, replays, interviews, and the halftime show, the game tab
  is audible and Spotify is paused.
- Mute within a few seconds of a break starting; unmute within a few seconds of
  the game returning.
- Zero per-game setup beyond clicking the extension once after the game starts.
  No per-network calibration.
- A single hotkey corrects a wrong decision immediately.
- Everything runs locally. No accounts, no servers, no network calls.
- A debug view and exportable log so thresholds can be tuned from real games.

## 3. Non-goals

- Skipping or fast-forwarding through commercials (the stream is live).
- Blacking out or covering the video during commercials. Audio only.
- Supporting sports other than football. The design is sport-agnostic, but
  only football is tested and tuned in v1.
- Supporting browsers other than Chrome, or operating systems other than
  macOS.
- Controlling the Spotify web player or any music app other than the Spotify
  desktop app.
- Spotify playlist curation. Spotify resumes whatever it was last playing.
- Learning from user corrections to improve future detection (v1.1 candidate).

## 4. Anti-goals

These would make the tool a failure even if it technically works:

- **Muting the game during play.** A missed play is worse than hearing part of
  an ad. When in doubt, stay on the game.
- **Flapping.** Switching back and forth every few seconds during a replay or a
  talky ad is intolerable. Decisions must have hysteresis.
- **Requiring Spotify Premium, an API key, or an OAuth login.**
- **Sending screenshots or audio anywhere.**
- **Requiring Aaron to recalibrate when the network, score bug layout, or
  fullscreen state changes.**

## 5. Constraints

- **Platform:** macOS 26.5, Google Chrome (current stable), Spotify desktop app
  installed at `/Applications/Spotify.app`.
- **Source:** seasons4u, viewed in a Chrome tab. The video player may live in a
  cross-origin iframe. Whether the stream is DRM-protected is unknown (see
  risks, §9).
- **Chrome extension platform:** Manifest V3. Tab capture must be started from
  a user gesture (clicking the toolbar icon) and held in an offscreen document.
  Service workers are ephemeral; all long-lived state lives in the offscreen
  document.
- **Native messaging:** the only sanctioned path from an extension to the
  Spotify desktop app. Requires a host manifest installed under
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
  referencing the extension's ID.
- **CPU budget:** under 10% of one core sustained, so it can run for a
  three-hour game on a laptop without fan noise.
- **No build-time network dependencies at runtime.** The audio model and all
  libraries are bundled with the extension.

## 6. Architecture

Two components:

```
┌──────────────────────── Chrome ────────────────────────┐
│  seasons4u tab                                          │
│    └─ badge.js (content script, all frames)             │
│                                                         │
│  Extension                                              │
│    sw.js            toolbar click, hotkeys, menus,      │
│                     native messaging port                │
│    offscreen.html   holds tabCapture stream; audio      │
│      ├─ vision.js   scoreboard learning + presence       │
│      ├─ audio.js    YAMNet embeddings, game/ad banks     │
│      ├─ detector.js state machine → verdict              │
│      └─ controller.js verdict + overrides → mute state   │
│    debug.html       live signals, chart, export log     │
│    options.html     settings                            │
└───────────────────────────┬─────────────────────────────┘
                            │ native messaging (stdio JSON)
                            ▼
┌──────────────── Mac native host ───────────────────────┐
│  spotify-host     {"state":"commercial"} → Spotify play │
│                   {"state":"game"}       → Spotify pause│
│                   via AppleScript (osascript)           │
└─────────────────────────────────────────────────────────┘
```

### 6.1 Chrome extension

**Capture.** On toolbar click, the service worker obtains a tab media stream ID
for the active tab and hands it to the offscreen document, which opens a
`getUserMedia` stream with both audio and video. Chrome routes the tab's audio
through this capture, so the offscreen document plays it back through a Web
Audio `GainNode`. Muting is a gain ramp to zero; unmuting is a ramp back to
one. Fades are ~300 ms so transitions are not jarring.

**Vision (scoreboard).** Video frames are sampled at 2 fps into a small canvas
(longest side ≈ 480 px). For the first ~30 s the module looks for pixel regions
that are sharp and unchanged across *most* frames while the rest of the frame
changes. Those regions are the persistent broadcast graphics: the scoreboard
and the network logo. Frozen frames (buffering, paused) are skipped so static
field lines are not learned. The learned overlay is split into connected
components so the scoreboard and the logo are tracked separately.

After learning, each frame produces a **scoreboard visibility** score (0–1) per
component. Learning continues in the background: if a new fixed graphic appears
during confirmed game audio, it is added. If a learned component stops matching
for a long stretch of confirmed game audio, the layout changed (e.g. fullscreen
toggle) and the scoreboard is relearned while the audio profile is kept.

**Audio.** Captured audio is resampled to 16 kHz mono and fed to a bundled
YAMNet model (TensorFlow.js) in ~1 s windows, producing both a class
distribution (speech / music / crowd / silence) and a 1024-d embedding.

- While the scoreboard is visible, embeddings are added to a **game bank**
  (what this broadcast sounds like).
- Once a long confirmed break has been heard (scoreboard gone 40 s+ with music),
  its embeddings are added to an **ad bank**.
- **Game similarity** = cosine similarity to the game bank's centroid.
- **Ad probability** = once both banks exist, the mean of (a) nearest-bank
  comparison and (b) 1 − game similarity. Before an ad bank exists, (b) alone.

**Black cut.** A frame with mean luminance near zero coinciding with near-silent
audio is a black cut.

**Detector state machine.** Two states, GAME and COMMERCIAL, with these
transition rules (initial defaults; all tunable from the debug panel):

Enter COMMERCIAL when either:
- scoreboard gone ≥ 3 s **and** ad probability ≥ 0.75 for ≥ 2 s; or
- a black cut occurs within 20 s after the scoreboard left.

Stay in GAME (do not enter COMMERCIAL) when:
- any learned graphic component (scoreboard or logo) is ≥ 80% visible; or
- scoreboard has been ≥ 40% visible for 3 consecutive seconds (resets the
  "gone" timer so short dips do not accumulate); or
- in the first 30 s after the scoreboard left, the audio is neither speech nor
  music (crowd, whistles) — this counts as neither game nor ad.

Leave COMMERCIAL (return to GAME) when either:
- scoreboard ≥ 85% visible in one frame, or ≥ 40% in 3 consecutive frames; or
- game similarity ≥ 0.70 in 5 of the last 6 seconds.

Never leave COMMERCIAL on the network logo alone: ads reuse network graphics.

Before the game bank has enough samples (cold start), only the scoreboard can
trigger either transition, and the "gone" requirement is raised to 40 s so
replays are never muted on a cold start.

**Controller.** Combines the detector verdict with user overrides:
- `Alt+Shift+M` while muted: unmute now and ignore the rest of this break.
- `Alt+Shift+M` while unmuted: mute now until pressed again or until the
  scoreboard leaves and returns.
- `Alt+Shift+P`: pause automatic switching (remembered across sessions).

The controller owns the actual mute state and is the only thing that talks to
the native host, so overrides and detector decisions can never disagree about
what Spotify should be doing.

**On-page badge.** A small Shadow-DOM overlay injected into all frames of the
game tab (so it appears inside a cross-origin player iframe and in fullscreen).
Shows learning progress, current state, and Unmute / Pause buttons.

**Debug panel.** Live video thumbnail with learned components outlined, a
rolling chart of scoreboard visibility, game similarity, ad probability, and
state, plus **Export log** (JSON of every per-second sample, verdicts, mute
state, and overrides). The exported log is the input to the offline tuning
harness (§7).

**Options page.** Spotify behavior (resume vs. a specific playlist URI; launch
Spotify if not running), fade durations, and threshold overrides.

### 6.2 Native host

A single executable with no runtime dependencies beyond macOS. It speaks
Chrome's native messaging protocol on stdin/stdout (4-byte little-endian length
prefix + UTF-8 JSON). Messages:

| From extension | Host action |
|---|---|
| `{"cmd":"commercial"}` | `tell application "Spotify" to play` |
| `{"cmd":"game"}` | `tell application "Spotify" to pause` |
| `{"cmd":"status"}` | reply with Spotify running? player state? current track |
| `{"cmd":"play_uri","uri":"spotify:playlist:…"}` | `play track uri` (when a playlist is configured) |

If Spotify is not running when a commercial starts, the host launches it and
plays (configurable; default on). The host is idempotent: repeated `game`
messages while already paused are harmless. Every message gets a reply so the
extension can show "Spotify: connected" in the badge.

An install script writes the native messaging manifest with the extension's ID
and the absolute path to the host binary.

### 6.3 Sequencing on a transition

Commercial starts: fade tab gain to 0 over 300 ms → send `commercial`.
Game returns: send `game` → wait for reply (or 200 ms) → fade tab gain to 1.
Spotify's own volume is never touched.

## 7. Testing and tuning

- **Unit tests** for the detector state machine fed synthetic per-second signal
  sequences: a clean break, a long replay, a cold-start break, a talky ad, a
  halftime show, a layout change. Each asserts the exact second of each
  transition and that no flapping occurs.
- **Unit tests** for vision learning on synthetic frame sequences (a fixed
  rectangle over changing noise; a frozen-frame run; a layout shift).
- **Replay harness:** a CLI that takes an exported debug log and re-runs the
  detector offline with chosen thresholds, reporting seconds of ad heard and
  seconds of game muted. This is how thresholds get tuned after the first real
  game; the defaults above are starting points borrowed from published results
  on three labeled games, not measurements from seasons4u.
- **Native host tests:** protocol framing round-trip; AppleScript invocation
  mocked; "Spotify not running" path.
- **Manual acceptance (first Sunday):** run in shadow mode (detect and log, do
  not switch) for one quarter, inspect the chart, then enable switching.

## 8. User flow

1. One-time: load the unpacked extension in `chrome://extensions`, run the host
   install script, pin the icon.
2. Game day: open seasons4u, start the game, go fullscreen if desired, click
   the extension icon. Badge says "Learning scoreboard…".
3. ~30 s later: "Armed." From then on it switches by itself.
4. If it gets one wrong: `Alt+Shift+M`.
5. After the game, optionally export the log from the debug panel for tuning.

## 9. Risks

- **DRM video blackout.** If seasons4u uses encrypted media, Chrome may deliver
  black video frames to tab capture even though audio still flows. Mitigation:
  the detector degrades to audio-only mode (scoreboard never learned, so the
  cold-start rules apply permanently: 40 s absence + ad probability). This is
  worse at catching short breaks but never mutes the game. The first run's
  debug panel reveals immediately whether frames are black.
- **Talky ads.** Narrated ads that sound like commentary for 10+ s are the
  known weak spot of audio similarity. The ad bank mitigates this after the
  first long break. Expect some ad audio to leak early in each game.
- **Cold start.** The first break after arming may be caught late because the
  game bank is still small. Acceptable; documented in the badge text.
- **Chrome autoplay / capture policy changes.** MV3 tab capture has been stable,
  but Chrome could change the offscreen-document rules. Low likelihood.
- **Native host path.** The manifest hard-codes the binary path and extension
  ID; moving the project folder or reloading the unpacked extension with a new
  ID breaks it. The install script must be re-runnable and print the ID it used.

## 10. Prior art consulted

- Commercial Mute (Chrome extension, 2026): source of the audio-similarity
  approach, black-cut rule, asymmetric unmute, and the initial threshold
  values. No license; ideas reused, no code.
- sports-ad-blocker (Windows): dual-anchor scoreboard + logo, "logo alone
  cannot restore", OCR fallback on game clock.
- The Clicker (HDMI capture): logo + color profile; author found thresholds
  more practical than a trained model; "mark content / mark commercial →
  suggest thresholds" tuning UX inspired the replay harness.

## 11. Decisions made (and by whom)

| Decision | Who |
|---|---|
| Chrome extension for detection, native host for Spotify | Claude's call, Aaron approved |
| Audio similarity as the deciding signal; green ratio dropped | Claude's call, Aaron approved |
| Spotify desktop app via AppleScript, not Web API | Claude's call (no Premium/OAuth); Spotify desktop confirmed installed |
| Spotify resumes current context by default; playlist URI optional | Claude's guess, flagged |
| Game tab fully muted during ads, not ducked | Claude's guess, flagged |
| Launch Spotify if not running | Claude's guess, flagged |
| Football only in v1 | Claude's call |
| Learning from corrections deferred to v1.1 | Claude's call |

## 12. Left to the builder

- Native host implementation language (must compile to a dependency-free
  binary; Swift or Go suggested).
- Extension build tooling (plain ES modules vs. a bundler), TF.js version,
  YAMNet model packaging.
- Exact connected-component and frame-differencing algorithms for scoreboard
  learning, as long as they meet the behaviors in §6.1.
- Debug panel charting library and layout.
- Hotkey choice if `Alt+Shift+M/P` collide with anything on macOS.
