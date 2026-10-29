// Offscreen document: holds the tab capture, plays audio through a gain node, feeds the pipeline.
import { ScoreboardLearner, toGray, FRAME_W, FRAME_H } from './lib/vision.js';
import { Detector } from './lib/detector.js';
import { Controller } from './lib/controller.js';
import { Bank } from './lib/banks.js';
import { SampleLog } from './lib/log.js';
import { createPipeline } from './lib/pipeline.js';
import { createAudioFeatures } from './lib/audio-features.js';
import { mergeSettings } from './lib/settings.js';
import { createTestRecorder, testFolderName } from './lib/test-recorder.js'; // TEST-ONLY

const video = document.getElementById('v');
const canvas = document.createElement('canvas');
canvas.width = FRAME_W; canvas.height = FRAME_H;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let stream = null, playCtx = null, gain = null, anaCtx = null;
let frameTimer = null, tickTimer = null, statusTimer = null, frameReader = null;
let pipeline = null, learner = null, log = null, settings = mergeSettings();
let audioFeatures = null, t0 = 0, hasAudio = false, hasVideo = false, lastFrameAt = 0, lastLum = null;
let ready = Promise.resolve(); // settles when the latest start() has finished
let testRec = null; // TEST-ONLY

const toSw = (msg) => chrome.runtime.sendMessage({ target: 'sw', ...msg }).catch(() => {});

function ramp(value, ms) {
  if (!gain) return;
  const now = playCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + ms / 1000);
}

const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

// Actions arrive in the controller's order (e.g. [spotify game, fadeIn]); Spotify commands are awaited
// (bounded) before the next step so Spotify is paused before the game audio fades back in.
async function applyActions(actions) {
  for (const a of actions) {
    if (a.type === 'fadeOut') ramp(0, settings.fadeMs);
    else if (a.type === 'fadeIn') ramp(1, settings.fadeMs);
    else if (a.type === 'spotify') await withTimeout(toSw({ type: 'actions', actions: [a] }), 800);
    else if (a.type === 'badge') toSw({ type: 'badge', text: a.text });
  }
}

function pushFrame(source) {
  ctx.drawImage(source, 0, 0, FRAME_W, FRAME_H);
  const { data } = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
  const gray = toGray(data, FRAME_W, FRAME_H);
  let sum = 0; for (let i = 0; i < gray.length; i += 97) sum += gray[i];
  lastLum = sum / Math.ceil(gray.length / 97);
  lastFrameAt = performance.now();
  pipeline.onFrame(gray);
}

// Preferred: read VideoFrames straight off the track. A <video> element in a hidden offscreen
// document is not painted by Chrome, so drawing it yields black frames; the track processor is not
// subject to that.
async function readFrames(track) {
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();
  frameReader = reader;
  let last = 0;
  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      const now = performance.now();
      if (now - last >= 230 && pipeline) { last = now; pushFrame(frame); } // ≈4 fps: black cuts at a break are brief
      frame.close();
    }
  } catch (e) { console.warn('frame reader ended', e.message); }
}

// Fallback for browsers without MediaStreamTrackProcessor: draw the <video> element.
function grabFrame() {
  if (!video.videoWidth || !pipeline) return;
  pushFrame(video);
}

function tick(pcm) {
  const t = Math.round((performance.now() - t0) / 1000);
  const record = pipeline.tick(t, pcm);
  toSw({ type: 'sample', record, hasAudio, hasVideo, blackVideo: hasVideo && lastLum !== null && lastLum < 2, components: learner.learned ? learner.components() : [] });
}

async function start(msg) {
  try { await startInner(msg); }
  catch (e) {
    console.error('start failed', e);
    await stop(false);
    toSw({ type: 'status', armed: false, error: e.message || String(e) });
  }
}

async function startInner({ streamId }) {
  await stop(false);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 640, maxHeight: 360, maxFrameRate: 15 } },
  });
  hasAudio = stream.getAudioTracks().length > 0;
  video.srcObject = stream;
  for (const tr of stream.getTracks()) tr.onended = () => stop(true);

  // Playback path: tab audio → gain → speakers (this is what gets muted).
  playCtx = new AudioContext();
  gain = playCtx.createGain(); gain.gain.value = 1;
  if (hasAudio) { playCtx.createMediaStreamSource(stream).connect(gain); gain.connect(playCtx.destination); }

  // Detection parts
  learner = new ScoreboardLearner();
  log = new SampleLog();
  const detector = new Detector(settings.detector);
  const controller = new Controller({ shadow: settings.shadow });
  if (!audioFeatures) audioFeatures = await createAudioFeatures(chrome.runtime.getURL('').replace(/\/$/, ''));
  pipeline = createPipeline({
    learner, detector, controller, gameBank: new Bank(), adBank: new Bank(), log,
    classify: (pcm) => audioFeatures.classify(pcm), onActions: applyActions,
    opts: { keepEmbedding: settings.keepEmbeddings },
  });
  t0 = performance.now();

  // Analysis path: tab audio → 16 kHz context → worklet → 1 s PCM chunks → tick
  if (hasAudio) {
    anaCtx = new AudioContext({ sampleRate: 16000 });
    await anaCtx.audioWorklet.addModule('worklet-pcm.js');
    const node = new AudioWorkletNode(anaCtx, 'pcm-1s');
    const sink = anaCtx.createGain(); sink.gain.value = 0;
    anaCtx.createMediaStreamSource(stream).connect(node).connect(sink).connect(anaCtx.destination);
    node.port.onmessage = (e) => tick(e.data);
  } else {
    tickTimer = setInterval(() => tick(null), 1000);
  }
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack && 'MediaStreamTrackProcessor' in self) readFrames(videoTrack);
  else frameTimer = setInterval(grabFrame, 250);
  statusTimer = setInterval(() => {
    hasVideo = performance.now() - lastFrameAt < 2000;
    toSw({ type: 'status', armed: true, hasAudio, hasVideo, blackVideo: hasVideo && lastLum !== null && lastLum < 2, lum: lastLum, learned: learner.learned, progress: learner.progress });
  }, 1000);
  toSw({ type: 'badge', text: 'Learning…' });
}

// TEST-ONLY: record a copy of the captured tab next to the log (see lib/test-recorder.js).
async function testStart() {
  await ready;
  if (!stream || !log) return { ok: false, error: 'not armed' };
  if (testRec) return { ok: true };
  const folder = testFolderName();
  log.max = Math.max(log.max, 6 * 3600); // a whole game with pregame and overtime
  testRec = createTestRecorder({
    stream: new MediaStream(stream.getTracks().map(tr => tr.clone())),
    folder, save: saveToDownloads, getLog: () => log.toJSON(),
  });
  log.event('testRecording', { t: Math.round(performance.now() - t0) / 1000, folder }); // video 0 s = this log t
  return { ok: true, folder };
}

// TEST-ONLY: offscreen documents cannot download; the service worker does, from a blob URL that has to
// stay alive until the download completes.
async function saveToDownloads(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const r = await chrome.runtime.sendMessage({ target: 'sw', type: 'testSave', url, filename });
    if (!r?.ok) console.warn('test save failed', filename, r?.error);
  } catch (e) { console.warn('test save failed', filename, e.message); }
  finally { URL.revokeObjectURL(url); }
}

async function stop(notify) {
  if (testRec) { await testRec.stop(); testRec = null; } // TEST-ONLY: save the recording before the stream goes
  clearInterval(frameTimer); clearInterval(tickTimer); clearInterval(statusTimer);
  frameTimer = tickTimer = statusTimer = null;
  if (frameReader) { frameReader.cancel().catch(() => {}); frameReader = null; }
  lastFrameAt = 0; lastLum = null;
  if (pipeline) { pipeline.end(); pipeline = null; }
  if (gain) ramp(1, 50);
  if (stream) for (const tr of stream.getTracks()) { tr.onended = null; tr.stop(); }
  stream = null; video.srcObject = null;
  for (const c of [playCtx, anaCtx]) if (c) await c.close().catch(() => {});
  playCtx = anaCtx = gain = null;
  if (notify) toSw({ type: 'status', armed: false });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'start') ready = start(msg);
  else if (msg.type === 'stop') { stop(false).then(() => sendResponse(true)); return true; } // reply once saved
  else if (msg.type === 'testStart') { testStart().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message })); return true; } // TEST-ONLY
  else if (msg.type === 'settings') { settings = mergeSettings(msg.settings); if (pipeline) pipeline.setShadow(settings.shadow); }
  else if (msg.type === 'override' && pipeline) pipeline.override(msg.kind);
  else if (msg.type === 'label' && log) log.event('label', { label: msg.label });
  else if (msg.type === 'exportLog') { sendResponse(log ? log.toJSON() : null); return true; }
  else if (msg.type === 'thumbnail') {
    sendResponse(video.videoWidth ? canvas.toDataURL('image/jpeg', 0.6) : null); return true;
  }
});
