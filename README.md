# s4u ad-blocker

## Setup (macOS + Chrome)

```bash
bash host/install.sh
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → select the `ext/` folder.

## Use

Click the extension icon on the tab while the game is on. Click again to turn it off.

It starts in **shadow mode**: it decides but never mutes or touches Spotify. Right-click the icon →
**Open debug panel**, watch one break, then untick *Shadow mode* there to go live.

- `Option+Shift+M` mute/unmute now
- `Option+Shift+P` pause/resume automatic switching
- Right-click the icon → **Open debug panel** / **Settings**

## 🧪 Test recording (temporary — remove once tuning is done)

Right-click the icon → **🧪 TEST: record game (video + log)**. It turns the extension on for the tab (if it
isn't already) and records what the detector sees into `~/Downloads/s4u-test-<time>/`: a first part after a
minute, one every 15 minutes, and the rest when you stop. Right-click → **🧪 TEST: stop recording and save**
(or click the icon off) saves everything and turns it off. `cat part-*.webm > game.webm` joins the parts.

Everything for this is marked `TEST-ONLY` (`ext/lib/test-recorder.js`, the `downloads` permission).

## Develop

```bash
npm test
bash host/test.sh
```
