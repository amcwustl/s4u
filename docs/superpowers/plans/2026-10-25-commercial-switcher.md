# Commercial Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that mutes a seasons4u game tab and plays the Spotify desktop app during commercials, detecting breaks from the scoreboard, broadcast audio, and black cuts.

**Architecture:** Chrome MV3 extension holds a tab capture in an offscreen document, runs pure-JS detection modules on 1 Hz samples, and drives a `GainNode` for muting. A Swift native-messaging host receives `commercial` / `game` and runs AppleScript against Spotify. Detection logic lives in dependency-free ES modules tested with `node --test`; only the thin capture/wiring layer touches Chrome APIs.

**Tech Stack:** Chrome Manifest V3 (ES modules, no bundler), Web Audio + AudioWorklet, `@mediapipe/tasks-audio` 1.1.1 with the YAMNet classifier (`yamnet.tflite`, vendored), Swift 6.2 (`swiftc`), Node 22 (`node --test`), bash.

**Spec:** `docs/superpowers/specs/2026-10-25-commercial-switcher-design.md`

## Global Constraints

- macOS 26.5, Google Chrome 155, Spotify desktop app at `/Applications/Spotify.app`.
- The extension acts on exactly one tab (the one armed) and never touches other windows or tabs.
- Clicking the toolbar icon toggles fully on/off; off restores tab audio, pauses nothing, runs no detection.
- All processing local; the extension makes no network requests. Model and libraries vendored under `ext/vendor/` and `ext/model/`.
- CPU under 10% of one core sustained: video sampled at 2 fps at 320×180 gray; audio classified once per second.
- Fades are 300 ms gain ramps; Spotify's volume is never changed.
- Never leave COMMERCIAL on the network logo alone. When in doubt stay in GAME.
- Build order: Tasks 1–3 form the end-to-end slice (manual mute → Spotify) and must run before any detection work.
- Native host: dependency-free compiled binary; protocol is 4-byte little-endian length prefix + UTF-8 JSON on stdio.
- Commit after every task with the message given; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

## Review Focus

1. **Spotify not running when a break starts** → host launches it hidden (`open -gj -a Spotify`), waits until it responds, then plays; never brings it to the front. Test in Task 2.
2. **User clicks Chrome's "Stop sharing" bar mid-game** → capture track ends; extension must disarm: fade tab in, send `game`, badge "Off". Test in Task 6 (controller `end()`) and manual step in Task 9.
3. **Audio track absent** (user unchecked "Also share tab audio") → badge warns, detector gets `adProb: null`, `gameSim: null` and runs scoreboard-only with the 40 s cold-start rule. Test in Task 5.
4. **Buffering/frozen frames during learning** → vision must skip them so field lines are not learned. Test in Task 7.
5. **Video black from DRM** (`scoreboardVis: null` forever) → audio-only rule applies, never mutes without ≥ 15 s of ad-probability ≥ 0.75. Test in Task 5.

## File Structure

```
ext/
  manifest.json            MV3, pinned "key", commands, offscreen + tabCapture + nativeMessaging perms
  sw.js                    toolbar toggle, commands, offscreen lifecycle, native port, badge relay
  offscreen.html/.js       capture stream, two AudioContexts, sampling loop, wires lib/* to actions
  worklet-pcm.js           AudioWorkletProcessor: posts 1 s Float32Array(16000) chunks
  lib/banks.js             cosine, Bank, gameSimilarity, adProbability  (pure)
  lib/detector.js          DEFAULTS, Detector state machine              (pure)
  lib/controller.js        verdict + overrides → mute state + actions    (pure)
  lib/vision.js            ScoreboardLearner on gray frames              (pure)
  lib/log.js               ring buffer of samples/events, toJSON          (pure)
  lib/audio-features.js    MediaPipe wrapper → {scores, speech, music, silence}
  badge.js / badge.css     content script overlay (all frames)
  debug.html/.js           live chart, export log
  options.html/.js         settings via chrome.storage.sync
  vendor/mediapipe/        audio_bundle.mjs + wasm/*
  model/yamnet.tflite
host/
  spotify-host.swift       native messaging host
  install.sh               compiles host, derives extension ID from manifest key, writes host manifest
  test.sh                  protocol tests with a fake osascript on PATH
tests/*.test.mjs           node --test for lib/*
tools/
  tab-recorder.html        (exists) record a tab to .webm
  replay.mjs               re-run Detector over an exported log with threshold overrides
  fixture-player.html      run the pipeline on a local .webm
```

---

### Task 1: Extension skeleton, toggle, capture, manual mute

**Files:**
- Create: `ext/manifest.json`, `ext/sw.js`, `ext/offscreen.html`, `ext/offscreen.js`, `package.json`
- Create: `tests/smoke.test.mjs`

**Interfaces:**
- Produces: sw ↔ offscreen messages `{type:'start', streamId, tabId}`, `{type:'stop'}`, `{type:'setGain', value:0|1}`, offscreen → sw `{type:'status', armed, hasAudio, hasVideo, luminance}`.
- Produces: `chrome.storage.session` key `armedTabId: number|null`.

- [ ] **Step 1: `package.json`** with `"type":"module"`, `"scripts":{"test":"node --test tests/"}`. No dependencies.

- [ ] **Step 2: Write `tests/smoke.test.mjs`** asserting `ext/manifest.json` parses, `manifest_version === 3`, `permissions` includes `tabCapture`, `offscreen`, `nativeMessaging`, `storage`, `scripting`, `activeTab`; `commands['toggle-mute'].suggested_key.default === 'Alt+Shift+M'` and `commands['toggle-pause'].suggested_key.default === 'Alt+Shift+P'`; `key` is a non-empty string; `background.service_worker === 'sw.js'` with `type: 'module'`; `content_security_policy.extension_pages` contains `'wasm-unsafe-eval'`.

- [ ] **Step 3: Run** `npm test` → FAIL (manifest missing).

- [ ] **Step 4: Generate the pinned key:** `openssl genrsa 2048 > host/.ext-key.pem` (gitignored); `openssl pkcs8 -topk8 -nocrypt -in host/.ext-key.pem -outform DER | openssl base64 -A` → value of `"key"`. Add `host/.ext-key.pem` to `.gitignore`.

- [ ] **Step 5: Write `ext/manifest.json`** satisfying Step 2, plus `action: {default_title: 'Commercial Switcher: off'}`, `host_permissions: ['<all_urls>']`, `web_accessible_resources` for `vendor/*` and `model/*`.

- [ ] **Step 6: Write `ext/sw.js`:** on `action.onClicked(tab)`: if `armedTabId === tab.id` → stop (send `{type:'stop'}`, close offscreen, badge text `''`); else → `chrome.tabCapture.getMediaStreamId({targetTabId: tab.id})`, ensure offscreen doc (`chrome.offscreen.createDocument({url:'offscreen.html', reasons:['USER_MEDIA'], justification:'tab audio/video analysis'})`), send `{type:'start', streamId, tabId}`, set action badge text `ON`. On `commands.onCommand('toggle-mute')` → flip a `manualMuted` boolean and send `{type:'setGain', value}` (temporary until Task 6 replaces this with the controller). On status message with `armed:false` → clear `armedTabId`, badge `''`.

- [ ] **Step 7: Write `ext/offscreen.js`:** on `start`: `getUserMedia({audio:{mandatory:{chromeMediaSource:'tab', chromeMediaSourceId}}, video:{mandatory:{chromeMediaSource:'tab', chromeMediaSourceId, maxWidth:640, maxHeight:360, maxFrameRate:15}}})`; playback graph `MediaStreamSource → GainNode → destination` in a default-rate `AudioContext`; `<video muted autoplay>` for frames; every 1 s post `status` with `hasAudio`, `hasVideo`, mean luminance of a 32×18 draw. `setGain` → `gain.linearRampToValueAtTime(value, now+0.3)`. `stop` and `track.onended` → stop all tracks, ramp gain to 1, post `{type:'status', armed:false}`.

- [ ] **Step 8: Run** `npm test` → PASS. Load unpacked `ext/` in `chrome://extensions`, note the ID shown matches `host/install.sh`'s derivation later. Arm on a YouTube tab, press Alt+Shift+M twice: audio drops out and returns with a fade; click icon again: audio stays on, badge clears.

- [ ] **Step 9: Commit** `feat(ext): skeleton with toggle, tab capture, manual mute`

### Task 2: Swift native host

**Files:**
- Create: `host/spotify-host.swift`, `host/install.sh`, `host/test.sh`, `host/fake-bin/osascript`

**Interfaces:**
- Produces: host name `com.s4u.spotify_host`. Requests `{cmd:'commercial'|'game'|'status'|'play_uri', uri?}`; replies `{ok:boolean, running:boolean, state?:'playing'|'paused'|'stopped', track?:string, error?:string}`.

- [ ] **Step 1: Write `host/fake-bin/osascript`** (bash): appends its args to `$FAKE_LOG`; for scripts containing `player state` prints `paused`; `name of current track` prints `Fake Track`; `processes) contains "Spotify"` prints `$FAKE_RUNNING` (default `true`).

- [ ] **Step 2: Write `host/test.sh`** that builds the host, then uses `node -e` to frame each JSON and pipe it to the binary, asserting:
  - `{"cmd":"status"}` → reply `ok:true, running:true, state:"paused", track:"Fake Track"`.
  - `{"cmd":"commercial"}` → `FAKE_LOG` contains `tell application "Spotify" to play`; reply `ok:true`.
  - `{"cmd":"game"}` → log contains `to pause`.
  - `{"cmd":"play_uri","uri":"spotify:playlist:abc"}` → log contains `play track "spotify:playlist:abc"`.
  - `FAKE_RUNNING=false` + `commercial` → log contains `open -gj -a Spotify` (via a fake `open` in `fake-bin` too) before `to play`; reply `ok:true`.
  - `{"cmd":"bogus"}` → `ok:false, error:"unknown cmd"`.
  - Two messages in one stdin stream → two replies, each correctly length-prefixed.

- [ ] **Step 3: Run** `bash host/test.sh` → FAIL (no binary).

- [ ] **Step 4: Write `host/spotify-host.swift`:** `readMessage() -> [String:Any]?` (4-byte LE length, JSON), `writeMessage(_:)`, `osa(_ script:String) -> String` via `Process` running `osascript -e` found on `PATH`, `isRunning() -> Bool`, `ensureRunning()` (`open -gj -a Spotify`, then poll `isRunning` up to 5 s), `handle(_ msg) -> [String:Any]`. Loop until EOF. Unknown cmd → `ok:false, error:"unknown cmd"`.

- [ ] **Step 5: Write `host/install.sh`:** `swiftc -O host/spotify-host.swift -o host/bin/spotify-host`; derive extension ID from `ext/manifest.json`'s `key`: base64-decode → `openssl rsa -pubin -inform DER -pubout -outform DER | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p'`; write `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.s4u.spotify_host.json` with `name`, `description`, absolute `path`, `type:"stdio"`, `allowed_origins:["chrome-extension://<ID>/"]`; print the ID.

- [ ] **Step 6: Run** `bash host/test.sh` → all PASS. Run `bash host/install.sh` and confirm the printed ID equals the one `chrome://extensions` shows.

- [ ] **Step 7: Commit** `feat(host): Swift native messaging host for Spotify`

### Task 3: Wire hotkey → Spotify (end of vertical slice)

**Files:**
- Modify: `ext/sw.js`

**Interfaces:**
- Produces in `sw.js`: `connectHost(): Port` with auto-reconnect (1 s, 2 s, 4 s… cap 30 s), `hostSend(msg): Promise<reply>` (rejects after 2 s), `hostState: {connected:boolean, lastReply}`.

- [ ] **Step 1: Implement `connectHost`/`hostSend`** using `chrome.runtime.connectNative('com.s4u.spotify_host')`; on `onDisconnect` schedule reconnect while armed; on disarm, disconnect.

- [ ] **Step 2: Make Alt+Shift+M** send `setGain 0` + `hostSend({cmd:'commercial'})` when muting, `hostSend({cmd:'game'})` then `setGain 1` when unmuting. Action title shows `Spotify: connected|disconnected`.

- [ ] **Step 3: Manual verification** on the real seasons4u tab: arm; at a commercial press Alt+Shift+M → tab fades out, Spotify plays within 1 s; press again → Spotify pauses, game fades in. Quit Spotify, press Alt+Shift+M → Spotify launches in the background (not frontmost) and plays. Click the icon to disarm while muted → game audio returns, Spotify paused.

- [ ] **Step 4: Commit** `feat: manual mute drives Spotify via native host`

### Task 4: Audio banks

**Files:**
- Create: `ext/lib/banks.js`, `tests/banks.test.mjs`

**Interfaces:**
- Produces: `cosine(a: Float32Array, b: Float32Array): number`; `class Bank { constructor(maxSize = 600); add(v: Float32Array): void; get size(): number; centroid(): Float32Array | null; nearest(v): number }` (ring buffer; `nearest` = max cosine over members, `-1` if empty); `gameSimilarity(game: Bank, v): number | null` (cosine to centroid; `null` if `game.size < MIN_GAME_SAMPLES`); `adProbability(game: Bank, ad: Bank, v): number | null`; `export const MIN_GAME_SAMPLES = 20`.
- Rule: with `ad.size === 0`: `1 − gameSimilarity`. Otherwise mean of `(ad.nearest(v) − game.nearest(v) + 1) / 2` and `1 − gameSimilarity`. All results clamped to `[0,1]`.

- [ ] **Step 1: Write tests:** `cosine` of identical = 1, orthogonal = 0, zero vector = 0; `Bank` evicts oldest past `maxSize`; `centroid` is the mean; `gameSimilarity` returns `null` below 20 samples and `≈1` for a vector equal to the centroid; `adProbability` with no ad bank = `1 − sim`; with an ad bank containing `v` itself and a game bank far away → `> 0.9`; with `v` in the game bank → `< 0.15`.

- [ ] **Step 2: Run** `node --test tests/banks.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `ext/lib/banks.js`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lib): game/ad audio banks`

### Task 5: Detector state machine

**Files:**
- Create: `ext/lib/detector.js`, `tests/detector.test.mjs`

**Interfaces:**
- Consumes: nothing (pure; banks are applied upstream).
- Produces:
  ```js
  export const DEFAULTS = {
    goneSec: 3, adProb: 0.75, adProbSec: 2, blackCutWindowSec: 20,
    holdVis: 0.8, dipVis: 0.4, dipHoldSec: 3, ambientWindowSec: 30, ambientMax: 0.5,
    recoverVisFast: 0.85, recoverVisSlow: 0.4, recoverSlowFrames: 3,
    recoverSim: 0.70, recoverSimHits: 5, recoverSimWindow: 6,
    coldGoneSec: 40, audioOnlyAdSec: 15, maxCommercialSec: 240,
  };
  // Sample: { t:number, scoreboardVis:number|null, logoVis:number|null,
  //           gameSim:number|null, adProb:number|null, speech:number, music:number, blackCut:boolean }
  // Verdict: { state:'GAME'|'COMMERCIAL', reason:string, goneSec:number }
  export class Detector { constructor(opts = {}); step(sample): Verdict; get state(); }
  ```
- Rules (one sample per second):
  - Enter COMMERCIAL: (`goneSec ≥ 3` and `adProb ≥ 0.75` for 2 consecutive samples, reason `audio`) or (`blackCut` and `0 < goneSec ≤ 20`, reason `black-cut`) or (`adProb === null` and `goneSec ≥ 40`, reason `cold-start`) or (`scoreboardVis === null` and `adProb ≥ 0.75` for 15 consecutive, reason `audio-only`). Absence alone never mutes when audio features are present.
  - Hold GAME: `max(scoreboardVis, logoVis) ≥ 0.8` → `goneSec = 0`, no transition. `scoreboardVis ≥ 0.4` for 3 consecutive → `goneSec = 0`. Within first 30 s of gone, samples with `speech < 0.5 && music < 0.5` do not count toward the adProb streak (streak unchanged, not reset).
  - Leave COMMERCIAL: `scoreboardVis ≥ 0.85` once, or `≥ 0.4` for 3 consecutive, or `gameSim ≥ 0.70` in ≥ 5 of the last 6 samples, or time in COMMERCIAL `≥ 240` s (reason `max-commercial`). `logoVis` is ignored for leaving.

- [ ] **Step 1: Write tests** as sequences built by a helper `seq(n, partial)`:
  - *clean break*: 60 s game (vis 0.95, sim 0.9, adProb 0.05) then vis 0 with adProb 0.9 → COMMERCIAL at exactly t = 60 + 4 (3 s gone + 2 consecutive, the 2nd lands at +4) — assert the first COMMERCIAL verdict's `t`; then vis 0.95 → GAME on that sample.
  - *long replay*: 45 s vis 0, sim 0.85, adProb 0.1 → never COMMERCIAL.
  - *black cut*: vis 0 at t=60, `blackCut` at t=62 → COMMERCIAL at t=62. `blackCut` at t=90 (goneSec 30) → no transition.
  - *logo holds*: vis 0, logoVis 0.9, adProb 0.9 for 30 s → stays GAME.
  - *logo cannot recover*: in COMMERCIAL, logoVis 0.95, vis 0, sim 0.1 → stays COMMERCIAL.
  - *audio recovery*: in COMMERCIAL, vis 0, sim 0.8 for 5 samples → GAME on the 5th.
  - *talky ad does not recover*: sim alternating 0.8,0.8,0.2,0.8,0.2,0.2 → stays COMMERCIAL.
  - *dip resets gone*: vis 0 for 2 s, vis 0.5 for 3 s, vis 0 → `goneSec` restarts at 1.
  - *ambient*: gone, speech 0.1 music 0.1 adProb 0.9 for 10 s → stays GAME; streak then completes once speech rises.
  - *cold start*: adProb null, vis 0 for 39 s → GAME; 40th → COMMERCIAL.
  - *audio-only (DRM)*: scoreboardVis null, adProb 0.9 for 14 → GAME; 15 → COMMERCIAL; then sim 0.8 ×5 → GAME.
  - *no audio track*: adProb null, gameSim null, vis 0.95 → GAME; vis 0 for 40 → COMMERCIAL; vis 0.9 → GAME.
  - *max commercial*: 240 s in COMMERCIAL with no signals → GAME with reason `max-commercial`.
  - *custom opts*: `new Detector({goneSec: 5})` shifts the clean-break time by 2.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `ext/lib/detector.js`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lib): detector state machine with spec thresholds`

### Task 6: Controller

**Files:**
- Create: `ext/lib/controller.js`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: `Verdict` from Task 5.
- Produces:
  ```js
  // Action: {type:'fadeOut'} | {type:'fadeIn'} | {type:'spotify', cmd:'commercial'|'game'} | {type:'badge', text:string}
  export class Controller {
    constructor({ shadow = false } = {});
    update(verdict): Action[];          // called once per second
    toggleMute(): Action[];             // Alt+Shift+M
    togglePause(): Action[];            // Alt+Shift+P
    end(): Action[];                    // disarm or capture ended
    get muted(); get paused(); get manual();
  }
  ```
- Semantics: auto COMMERCIAL → `[fadeOut, spotify commercial, badge 'Muted']`; auto GAME → `[spotify game, fadeIn, badge 'Game']` (order matters: Spotify pauses before game audio returns). Actions are emitted only on change. `toggleMute` while auto-muted → unmute and set `ignoreBreak` until the next GAME verdict. `toggleMute` while unmuted → manual mute until toggled again or until a COMMERCIAL→GAME verdict transition. `togglePause` → `paused`; if currently auto-muted, unmute; verdicts produce no actions while paused except badge `'Paused'`. `shadow` → every `fadeOut`/`spotify` replaced by `badge 'SHADOW: would mute'` / `'SHADOW: would unmute'`; fadeIn still never emitted since nothing muted. `end()` → if muted, `[spotify game, fadeIn]`, then `badge 'Off'`.

- [ ] **Step 1: Write tests** for each sentence above, asserting exact action arrays and that repeating the same verdict yields `[]`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lib): controller merges verdicts and overrides`

### Task 7: Scoreboard learner

**Files:**
- Create: `ext/lib/vision.js`, `tests/vision.test.mjs`

**Interfaces:**
- Produces:
  ```js
  export const FRAME_W = 320, FRAME_H = 180;
  export class ScoreboardLearner {
    constructor({ w = FRAME_W, h = FRAME_H, learnFrames = 60, stableFrac = 0.7, diffT = 12, gradT = 20, minArea = 40, frozenT = 1.0, matchT = 24 } = {});
    push(gray: Uint8Array): void;              // one frame; ignored once learned
    get learned(): boolean; get progress(): number;   // 0..1
    components(): Array<{ x, y, w, h, area, kind: 'scoreboard'|'logo' }>;  // kind: largest = scoreboard, others logo
    visibility(gray: Uint8Array): { scoreboard: number|null, logo: number|null, perComponent: number[] };
    reset(): void;
  }
  export function toGray(rgba: Uint8ClampedArray, w, h): Uint8Array;
  export function meanLuminance(gray: Uint8Array): number;
  ```
- Algorithm (the tests do not determine it): per pixel, count frames where `|gray − prevGray| < diffT` and Sobel magnitude `> gradT`; skip a frame entirely if mean `|gray − prevGray| < frozenT` (frozen/buffering). After `learnFrames` accepted frames, mask = pixels with count/frames ≥ `stableFrac`; 4-connected components with area ≥ `minArea`; template per component = last accepted frame's pixels. `visibility` per component = fraction of its pixels with `|gray − template| < matchT`. `scoreboard` = largest component's visibility; `logo` = max of the rest; both `null` if not learned.

- [ ] **Step 1: Write tests** with synthetic 320×180 frames: random noise background redrawn each frame + a fixed 60×20 high-contrast block at (20,150) and a fixed 16×16 block at (290,10):
  - after 60 frames `learned === true`, two components, the larger at (20,150) ±2 px with `kind 'scoreboard'`.
  - `visibility` on a frame with blocks present → `scoreboard ≥ 0.9`, without → `≤ 0.2`.
  - 30 identical frames (frozen) interleaved → `progress` unchanged by them.
  - all-static frames (no noise, 200 pushes) → `learned === false` and `progress === 0`, because every frame after the first has mean diff below `frozenT` and is skipped.
  - `toGray` of pure red (255,0,0,255) → 76 ±1; `meanLuminance` of zeros → 0.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (also assert the test file runs in < 5 s).
- [ ] **Step 5: Commit** `feat(lib): scoreboard learner and visibility scoring`

### Task 8: Audio features (MediaPipe YAMNet) + self-test page

**Files:**
- Create: `ext/lib/audio-features.js`, `ext/worklet-pcm.js`, `tools/audio-selftest.html`, `tools/fetch-vendor.sh`
- Vendor: `ext/vendor/mediapipe/audio_bundle.mjs`, `ext/vendor/mediapipe/wasm/*` (from `@mediapipe/tasks-audio@1.1.1`), `ext/model/yamnet.tflite` (from `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite`, 4,126,810 bytes)

**Interfaces:**
- Produces: `createAudioFeatures(baseUrl: string): Promise<{ classify(pcm16k: Float32Array): { scores: Float32Array /*521*/, speech: number, music: number, silence: number } }>`; `AudioClassifier` created with `maxResults: -1, scoreThreshold: 0` so all 521 categories return; `speech`/`music`/`silence` read by category name `"Speech"`, `"Music"`, `"Silence"`. `scores` is the vector fed to `Bank`.
- Produces: `worklet-pcm.js` registers processor `'pcm-1s'` that accumulates input channel 0 and `port.postMessage(Float32Array(16000))` per second.

- [ ] **Step 1: Write `tools/fetch-vendor.sh`** (npm pack `@mediapipe/tasks-audio@1.1.1`, copy `audio_bundle.mjs` and `wasm/`, curl the model, verify byte size 4126810). Run it. Commit vendored files.
- [ ] **Step 2: Write `tools/audio-selftest.html`:** loads `audio-features.js` from `../ext/lib/`, classifies 1 s of a 440 Hz sine → prints top-3 categories and asserts `"Sine wave"` is in them; classifies 1 s of zeros → asserts `silence > 0.5`. Serve with `python3 -m http.server 8765` from repo root (wasm cannot load over `file://`).
- [ ] **Step 3: Implement** `audio-features.js` and `worklet-pcm.js`. Open the self-test → both assertions green; classify time printed `< 100 ms`.
- [ ] **Step 4: Commit** `feat(lib): YAMNet audio features via MediaPipe`

### Task 9: Offscreen pipeline, shadow mode, log

**Files:**
- Create: `ext/lib/log.js`, `tests/log.test.mjs`
- Modify: `ext/offscreen.js`, `ext/sw.js`

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces: `class SampleLog { constructor(max = 14400); push(record): void; event(name, data): void; toJSON(): { version: 1, started: iso, samples: [], events: [] } }` — record = `Sample` + `{ verdict, muted, shadow }`.
- Produces: offscreen → sw messages `{type:'sample', record}` (1 Hz, forwarded to debug panel and badge), `{type:'actions', actions}` for `spotify` actions (sw owns the host port). sw → offscreen `{type:'override', kind:'toggleMute'|'togglePause'}`, `{type:'settings', settings}`.
- Settings (chrome.storage.sync, defaults): `{ shadow: true, spotifyMode: 'resume', spotifyUri: '', launchSpotify: true, fadeMs: 300, detector: {} }`. **Shadow defaults to true** for the first run.

- [ ] **Step 1: Test `log.js`:** ring buffer caps at `max`; `toJSON()` round-trips through `JSON.parse`.
- [ ] **Step 2: Implement `log.js`**; run → PASS.
- [ ] **Step 3: Rewrite `offscreen.js` loop:** second `AudioContext({sampleRate:16000})` with `MediaStreamSource → AudioWorkletNode('pcm-1s')`; 2 fps `requestAnimationFrame`-throttled frame grab → `toGray` → `learner.push` until learned, then `visibility`; per 1 s PCM chunk: `classify` → `scores`; if `scoreboard ≥ holdVis` add to `gameBank`; if detector in COMMERCIAL ≥ 40 s and `music ≥ 0.5` add to `adBank`; build `Sample` (scoreboard/logo = max over the second's frames; `blackCut` = meanLuminance < 8 and PCM RMS < 0.005; `scoreboardVis: null` until learned or if `!hasVideo`); `detector.step` → `controller.update` → apply actions (`fadeOut/fadeIn` → gain ramps of `fadeMs`; `spotify` → post to sw; `badge` → post to sw); `log.push`. Relearn: if learned and `scoreboard < 0.2` for 60 consecutive GAME seconds → `learner.reset()`, `log.event('relearn')`. Background addition of newly appearing graphics (spec §6.1) is deferred to v1.1; relearn-on-loss covers the layout-change case.
- [ ] **Step 4: `sw.js`:** replace Task 3's manual mute with `override` forwarding; apply `spotify` actions via `hostSend` (`play_uri` when `spotifyMode === 'uri'`); on `end` from capture-ended, run `controller.end()` actions. Context menu item `Open debug panel` → `chrome.tabs.create({url: 'debug.html'})`.
- [ ] **Step 5: Manual verification** on seasons4u in shadow mode: badge text goes `Learning…` → `Armed` within ~35 s; action title shows `SHADOW` state changes at a break; Alt+Shift+P toggles `Paused`.
- [ ] **Step 6: Commit** `feat: full detection pipeline in offscreen document with shadow mode`

### Task 10: On-page badge

**Files:**
- Create: `ext/badge.js`, `ext/badge.css`; Modify: `ext/manifest.json` (content_scripts `<all_urls>`, `all_frames: true`, `run_at: document_idle`), `ext/sw.js`

**Interfaces:**
- Consumes: sw → tab `{type:'badge', text, state:'learning'|'game'|'muted'|'paused'|'off'|'shadow', spotify:boolean}`; badge → sw `{type:'override', kind}`.
- Produces: Shadow-DOM overlay top-right, 12 px font, auto-hides 4 s after `game` state, always visible in other states; buttons **Unmute** (`toggleMute`) and **Pause** (`togglePause`); shows `Spotify ✓/✗`; only renders in the frame whose document contains a `<video>` with `videoWidth > 0` (so one badge per tab, inside the player iframe).

- [ ] **Step 1: Implement.** **Step 2: Manual verification:** badge appears inside the fullscreen player on the TV; clicking Unmute during a shadow break logs an override in the sample log.
- [ ] **Step 3: Commit** `feat: on-page badge with override buttons`

### Task 11: Debug panel and log export

**Files:**
- Create: `ext/debug.html`, `ext/debug.js`

**Interfaces:**
- Consumes: `{type:'sample', record}` relayed by sw via `chrome.runtime.connect({name:'debug'})`.
- Produces: canvas chart (no library) of last 600 s: `scoreboardVis`, `logoVis`, `gameSim`, `adProb` lines 0–1, state band (GAME/COMMERCIAL), mute band; a 160×90 live thumbnail with component rectangles (offscreen posts a JPEG data URL every 2 s on request); **Export log** → downloads `s4u-log-<iso>.json` = `SampleLog.toJSON()`; **Shadow mode** checkbox bound to settings; **Mark ad / Mark game** buttons (key `A`) → `log.event('label', {label})`.

- [ ] **Step 1: Implement.** **Step 2: Manual verification:** chart moves; export produces a file `tools/replay.mjs` (Task 12) can read.
- [ ] **Step 3: Commit** `feat: debug panel with live chart and log export`

### Task 12: Replay harness

**Files:**
- Create: `tools/replay.mjs`, `tests/replay.test.mjs`, `tests/fixtures/mini-log.json`

**Interfaces:**
- Consumes: `Detector`, `DEFAULTS`, exported log JSON.
- Produces: `node tools/replay.mjs <log.json> [--set goneSec=5 --set adProb=0.8]` prints transitions `t state reason`, and if `events` has `label` entries: `ad heard: N s`, `game muted: N s`. Exports `replay(log, overrides) → { transitions, adHeardSec, gameMutedSec }`.

- [ ] **Step 1: Write `mini-log.json`** (120 samples: 60 game, 40 ad labelled, 20 game) and test: `replay(log).transitions` has COMMERCIAL at t=64 and GAME at t=100; `adHeardSec === 4`; `gameMutedSec === 0`; `--set goneSec=10` moves COMMERCIAL to t=71.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(tools): offline replay harness for threshold tuning`

### Task 13: Fixture player (run the pipeline on the recording)

**Files:**
- Create: `tools/fixture-player.html`, `tools/fixture-player.js`

**Interfaces:**
- Consumes: `ext/lib/*` via relative imports; a local `.webm` chosen with `<input type=file>`.
- Produces: plays the file in a `<video>`, routes `captureStream()` through the same 16 kHz worklet + 2 fps gray pipeline as Task 9 (share code by moving the loop into `ext/lib/pipeline.js` with injected `classify`, `onSample`, `now`), draws the Task 11 chart, and offers **Export log**. Playback at `video.playbackRate = 2` is allowed; samples use media time, not wall time.

- [ ] **Step 1: Extract `ext/lib/pipeline.js`** `createPipeline({ learner, detector, controller, banks, classify, log, onActions })` returning `{ onFrame(gray, tSec), onPcm(pcm, tSec) }`; `offscreen.js` uses it. `npm test` still passes.
- [ ] **Step 2: Implement the player.** Serve with `python3 -m http.server 8765`; load the seasons4u recording; confirm scoreboard components are drawn over the real score bug and `adProb` rises during the recorded break. Export the log; run `node tools/replay.mjs` on it and record the default-threshold result in `docs/superpowers/plans/tuning-notes.md`.
- [ ] **Step 3: Commit** `feat(tools): fixture player runs the pipeline on recorded footage`

### Task 14: Options page

**Files:**
- Create: `ext/options.html`, `ext/options.js`; Modify: `ext/manifest.json` (`options_ui`)

- [ ] **Step 1: Implement** fields for every key in the Task 9 settings object, saved to `chrome.storage.sync` on change; `detector` overrides as a JSON textarea validated against `DEFAULTS` keys.
- [ ] **Step 2: Manual verification:** set `spotifyMode: 'uri'` with a playlist URI; a (non-shadow) break plays that playlist.
- [ ] **Step 3: Commit** `feat: options page`
