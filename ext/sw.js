// Service worker: toolbar toggle, hotkeys, offscreen lifecycle.
const OFFSCREEN_URL = 'offscreen.html';

async function getArmedTabId() {
  const { armedTabId = null } = await chrome.storage.session.get('armedTabId');
  return armedTabId;
}
async function setArmedTabId(id) {
  await chrome.storage.session.set({ armedTabId: id });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Analyze the armed tab\'s audio and video to detect commercials',
  });
}
async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) await chrome.offscreen.closeDocument();
}

function toOffscreen(msg) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});
}

async function disarm() {
  await toOffscreen({ type: 'stop' });
  await closeOffscreen();
  await setArmedTabId(null);
  manualMuted = false;
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Commercial Switcher: off' });
}

async function arm(tab) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();
  await setArmedTabId(tab.id);
  await toOffscreen({ type: 'start', streamId, tabId: tab.id });
  await chrome.action.setBadgeText({ text: 'ON' });
  await chrome.action.setTitle({ title: 'Commercial Switcher: armed' });
}

chrome.action.onClicked.addListener(async (tab) => {
  const armed = await getArmedTabId();
  if (armed === tab.id) await disarm();
  else {
    if (armed !== null) await disarm();
    await arm(tab);
  }
});

let manualMuted = false;
chrome.commands.onCommand.addListener(async (command) => {
  if ((await getArmedTabId()) === null) return;
  if (command === 'toggle-mute') {
    manualMuted = !manualMuted;
    await toOffscreen({ type: 'setGain', value: manualMuted ? 0 : 1 });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'sw') return;
  if (msg.type === 'status') {
    if (msg.armed === false) disarm();
    else chrome.action.setTitle({ title: `Commercial Switcher: armed (audio ${msg.hasAudio ? 'yes' : 'NO'}, video ${msg.hasVideo ? 'yes' : 'NO'}, lum ${msg.luminance?.toFixed(0)})` });
  }
});
