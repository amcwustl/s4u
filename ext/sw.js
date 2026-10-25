// Service worker: toolbar toggle, hotkeys, offscreen lifecycle, native host port.
import { createHostClient } from './lib/host-client.js';

const OFFSCREEN_URL = 'offscreen.html';
const HOST_NAME = 'com.s4u.spotify_host';

const host = createHostClient({
  connect: () => chrome.runtime.connectNative(HOST_NAME),
  onState: () => updateTitle(),
});
async function hostSend(msg) {
  try { return await host.send(msg); }
  catch (e) { console.warn('host', msg.cmd, e.message); return { ok: false, error: e.message }; }
}

let lastStatus = null;
function updateTitle() {
  const armed = lastStatus?.armed;
  const spotify = host.state.connected ? 'Spotify: connected' : 'Spotify: disconnected';
  const title = armed
    ? `Commercial Switcher: armed${manualMuted ? ' (MUTED)' : ''} — ${spotify} — audio ${lastStatus.hasAudio ? 'yes' : 'NO'}, video ${lastStatus.hasVideo ? 'yes' : 'NO'}`
    : 'Commercial Switcher: off';
  chrome.action.setTitle({ title });
}

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
  if (manualMuted) await hostSend({ cmd: 'game' });
  await toOffscreen({ type: 'stop' });
  await closeOffscreen();
  await setArmedTabId(null);
  manualMuted = false;
  host.stop();
  lastStatus = null;
  await chrome.action.setBadgeText({ text: '' });
  updateTitle();
}

async function arm(tab) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();
  await setArmedTabId(tab.id);
  await toOffscreen({ type: 'start', streamId, tabId: tab.id });
  host.start();
  hostSend({ cmd: 'status' });
  await chrome.action.setBadgeText({ text: 'ON' });
  lastStatus = { armed: true, hasAudio: false, hasVideo: false };
  updateTitle();
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
    if (manualMuted) {
      await toOffscreen({ type: 'setGain', value: 0 });
      await hostSend({ cmd: 'commercial' });
    } else {
      await hostSend({ cmd: 'game' });
      await toOffscreen({ type: 'setGain', value: 1 });
    }
    updateTitle();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'sw') return;
  if (msg.type === 'status') {
    if (msg.armed === false) { disarm(); return; }
    lastStatus = msg;
    updateTitle();
  }
});
