// Service worker: toolbar toggle, hotkeys, offscreen lifecycle, native host port, settings, relays.
import { createHostClient } from './lib/host-client.js';
import { mergeSettings } from './lib/settings.js';

const OFFSCREEN_URL = 'offscreen.html';
const HOST_NAME = 'com.s4u.spotify_host';

let settings = mergeSettings();
let lastStatus = null;
let lastBadge = '';
const debugPorts = new Set();

const host = createHostClient({
  connect: () => chrome.runtime.connectNative(HOST_NAME),
  onState: () => updateTitle(),
});
let inflight = Promise.resolve();
async function hostSend(msg) {
  const p = host.send(msg).catch((e) => { console.warn('host', msg.cmd, e.message); return { ok: false, error: e.message }; });
  inflight = inflight.then(() => p, () => p);
  return p;
}
let lastError = null;

async function loadSettings() {
  const stored = await chrome.storage.sync.get(null);
  settings = mergeSettings(stored);
  return settings;
}
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'sync') return;
  await loadSettings();
  toOffscreen({ type: 'settings', settings });
});

// TEST-ONLY: the "🧪 TEST" menu item arms the tab and records video + log to Downloads/s4u-test-…/.
const TEST_MENU = { off: '🧪 TEST: record game (video + log)', on: '🧪 TEST: stop recording and save' };
let testRecording = false;
let testSaveError = null;
async function setTestRecording(on) {
  testRecording = on;
  if (on) testSaveError = null;
  await chrome.storage.session.set({ testRecording: on });
  chrome.contextMenus.update('test', { title: TEST_MENU[on ? 'on' : 'off'] }, () => void chrome.runtime.lastError);
  await chrome.action.setBadgeBackgroundColor({ color: on ? '#d32f2f' : '#3c4043' });
}
async function toggleTest(tab) {
  if (testRecording) { await disarm(); return; } // disarm waits until every part is saved
  try {
    const armed = await getArmedTabId();
    if (armed !== tab.id) { if (armed !== null) await disarm(); await arm(tab); }
    const r = await toOffscreen({ type: 'testStart' });
    if (!r?.ok) throw new Error(r?.error ?? 'recording did not start');
    await setTestRecording(true);
    await setBadge(lastBadge);
  } catch (e) {
    lastError = `test recording: ${e.message}`;
    await chrome.action.setBadgeText({ text: 'ERR' });
    updateTitle();
  }
}
// Offscreen documents cannot download; they hand over a blob URL and keep it alive until this resolves.
async function testSave(url, filename) {
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'overwrite' });
    for (let i = 0; i < 600; i++) { // ≤ 5 min
      const [d] = await chrome.downloads.search({ id });
      if (d?.state === 'complete') return { ok: true };
      if (!d || d.state === 'interrupted') throw new Error(d?.error ?? 'download disappeared');
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('timed out');
  } catch (e) {
    testSaveError = `${filename}: ${e.message}`;
    updateTitle();
    return { ok: false, error: e.message };
  }
}

async function getArmedTabId() { return (await chrome.storage.session.get('armedTabId')).armedTabId ?? null; }
async function setArmedTabId(id) { await chrome.storage.session.set({ armedTabId: id }); }

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL, reasons: ['USER_MEDIA'],
    justification: 'Analyze the armed tab\'s audio and video to detect commercials',
  });
}
async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) await chrome.offscreen.closeDocument();
}
function toOffscreen(msg) { return chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {}); }

function updateTitle() {
  const spotify = host.state.connected ? 'Spotify ✓' : 'Spotify ✗';
  const title = lastStatus?.armed
    ? `Commercial Switcher: ${lastBadge || 'armed'}${settings.shadow ? ' [SHADOW]' : ''} — ${spotify} — audio ${lastStatus.hasAudio ? 'yes' : 'NO'}, video ${lastStatus.hasVideo ? (lastStatus.blackVideo ? 'BLACK' : 'yes') : 'NO'}`
    : lastError ? `Commercial Switcher: off — last error: ${lastError}` : 'Commercial Switcher: off';
  const test = testRecording ? `🧪 TEST RECORDING${testSaveError ? ` — SAVE FAILED ${testSaveError}` : ''}\n` : ''; // TEST-ONLY
  chrome.action.setTitle({ title: test + title });
}
const BADGE_CODES = { 'Learning…': 'ON', Game: 'ARM', Muted: 'MUTE', Paused: 'II', Off: '', 'SHADOW: would mute': 'SHDW', 'SHADOW: would unmute': 'ARM' };
async function setBadge(text) {
  lastBadge = text;
  await chrome.action.setBadgeText({ text: BADGE_CODES[text] ?? 'ON' });
  updateTitle();
  const tabId = await getArmedTabId();
  if (tabId !== null) chrome.tabs.sendMessage(tabId, { type: 'badge', text, shadow: settings.shadow, spotify: host.state.connected, test: testRecording }).catch(() => {});
}

async function disarm() {
  await toOffscreen({ type: 'stop' });   // offscreen saves any test recording, runs controller.end() → may send spotify game
  await new Promise(r => setTimeout(r, 150));
  await inflight;                        // let that Spotify pause complete (bounded by the 2 s reply timeout)
  await closeOffscreen();
  await setArmedTabId(null);
  host.stop();
  lastStatus = null;
  if (testRecording) await setTestRecording(false); // TEST-ONLY
  await setBadge('Off');
}

async function arm(tab) {
  lastError = null;
  await loadSettings();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();
  await setArmedTabId(tab.id);
  await toOffscreen({ type: 'settings', settings });
  await toOffscreen({ type: 'start', streamId, tabId: tab.id });
  host.start();
  hostSend({ cmd: 'game' }); // make sure Spotify is paused at kickoff; it resumes at the first break
  lastStatus = { armed: true, hasAudio: false, hasVideo: false };
  await setBadge('Learning…');
}

chrome.action.onClicked.addListener(async (tab) => {
  const armed = await getArmedTabId();
  if (armed === tab.id) await disarm();
  else { if (armed !== null) await disarm(); await arm(tab); }
});

chrome.commands.onCommand.addListener(async (command) => {
  if ((await getArmedTabId()) === null) return;
  if (command === 'toggle-mute') toOffscreen({ type: 'override', kind: 'toggleMute' });
  else if (command === 'toggle-pause') toOffscreen({ type: 'override', kind: 'togglePause' });
});

async function applySpotify(actions) {
  for (const a of actions) {
    if (a.cmd === 'commercial') {
      if (settings.spotifyMode === 'uri' && settings.spotifyUri) await hostSend({ cmd: 'play_uri', uri: settings.spotifyUri, launch: settings.launchSpotify });
      else await hostSend({ cmd: 'commercial', launch: settings.launchSpotify });
    } else if (a.cmd === 'game') await hostSend({ cmd: 'game' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'sw') {
    if (msg.type === 'status') {
      if (msg.armed === false) {
        if (msg.error) { lastError = msg.error; chrome.action.setBadgeText({ text: 'ERR' }); }
        disarm().then(() => { if (msg.error) chrome.action.setBadgeText({ text: 'ERR' }); });
        return;
      }
      lastStatus = msg; updateTitle();
    } else if (msg.type === 'badge') setBadge(msg.text);
    else if (msg.type === 'actions') { applySpotify(msg.actions).then(() => sendResponse({ ok: true })); return true; }
    else if (msg.type === 'testSave') { testSave(msg.url, msg.filename).then(sendResponse); return true; } // TEST-ONLY
    else if (msg.type === 'sample') for (const p of debugPorts) p.postMessage(msg);
    return;
  }
  // from content script badge
  if (msg?.type === 'override' && sender.tab) toOffscreen({ type: 'override', kind: msg.kind });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'debug') return;
  debugPorts.add(port);
  port.onDisconnect.addListener(() => debugPorts.delete(port));
  port.onMessage.addListener(async (m) => {
    if (m.type === 'exportLog') port.postMessage({ type: 'log', log: await chrome.runtime.sendMessage({ target: 'offscreen', type: 'exportLog' }).catch(() => null) });
    else if (m.type === 'thumbnail') port.postMessage({ type: 'thumbnail', dataUrl: await chrome.runtime.sendMessage({ target: 'offscreen', type: 'thumbnail' }).catch(() => null) });
    else if (m.type === 'label') toOffscreen({ type: 'label', label: m.label });
    else if (m.type === 'override') toOffscreen({ type: 'override', kind: m.kind });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'debug', title: 'Open debug panel', contexts: ['action'] });
  chrome.contextMenus.create({ id: 'options', title: 'Settings', contexts: ['action'] });
  chrome.contextMenus.create({ id: 'test', title: TEST_MENU[testRecording ? 'on' : 'off'], contexts: ['action'] }); // TEST-ONLY
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'test' && tab) toggleTest(tab); // TEST-ONLY
  if (info.menuItemId === 'debug') chrome.tabs.create({ url: chrome.runtime.getURL('debug.html') });
  if (info.menuItemId === 'options') chrome.runtime.openOptionsPage();
});

// MV3 service workers restart at will. If a tab is still armed (offscreen document keeps running),
// restore settings and the Spotify connection so breaks keep switching.
getArmedTabId().then(async (id) => {
  const { testRecording: rec = false } = await chrome.storage.session.get('testRecording'); // TEST-ONLY
  testRecording = rec && id !== null;
  chrome.contextMenus.update('test', { title: TEST_MENU[testRecording ? 'on' : 'off'] }, () => void chrome.runtime.lastError);
  if (id === null) return;
  await loadSettings();
  host.start();
  lastStatus = { armed: true, hasAudio: true, hasVideo: true };
  updateTitle();
});
