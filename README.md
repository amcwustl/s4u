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

## Develop

```bash
npm test
bash host/test.sh
```
