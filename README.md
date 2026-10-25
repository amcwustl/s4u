# s4u ad-blocker

## Setup (macOS + Chrome)

```bash
bash host/install.sh
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → select the `ext/` folder.

## Use

Click the extension icon on the tab while the game is on. Click again to turn it off.

- `Option+Shift+M` mute/unmute now
- `Option+Shift+P` pause/resume automatic switching
- Right-click the icon → **Open debug panel** / **Settings**

## Develop

```bash
npm test
bash host/test.sh
```
