// Offscreen document: holds the tab capture, plays audio through a gain node, feeds the pipeline.
import { ScoreboardLearner, toGray, FRAME_W, FRAME_H } from './lib/vision.js';
import { Detector } from './lib/detector.js';
import { Controller } from './lib/controller.js';
import { Bank } from './lib/banks.js';
import { SampleLog } from './lib/log.js';
import { createPipeline } from './lib/pipeline.js';
import { createAudioFeatures } from './lib/audio-features.js';
import { mergeSettings } from './lib/settings.js';

const video = document.getElementById('v');
const canvas = document.createElement('canvas');
canvas.width = FRAME_W; canvas.height = FRAME_H;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let stream = null, playCtx = null, gain = null, anaCtx = null;
let frameTimer = null, tickTimer = null, statusTimer = null;
let pipeline = null, learner = null, log = null, settings = mergeSettings();
let audioFeatures = null, t0 = 0, hasAudio = false, hasVideo = false;

const toSw = (msg) => chrome.runtime.sendMessage({ target: 'sw', ...msg }).catch(() => {});

function ramp(value, ms) {
  if (!gain) return;
  const now = playCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + ms / 1000);
}

function applyActions(actions) {
  const spotify = [];
  for (const a of actions) {
    if (a.type === 'fadeOut') ramp(0, settings.fadeMs);
    else if (a.type === 'fadeIn') ramp(1, settings.fadeMs);
    else if (a.type === 'spotify') spotify.push(a);
    else if (a.type === 'badge') toSw({ type: 'badge', text: a.text });
  }
  if (spotify.length) toSw({ type: 'actions', actions: spotify });
}

function grabFrame() {
  if (!video.videoWidth) { hasVideo = false; return; }
  hasVideo = true;
  ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H);
  const { data } = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
  pipeline.onFrame(toGray(data, FRAME_W, FRAME_H));
}

function tick(pcm) {
  const t = Math.round((performance.now() - t0) / 1000);
  const record = pipeline.tick(t, pcm);
  toSw({ type: 'sample', record, hasAudio, hasVideo, components: learner.learned ? learner.components() : [] });
}

async function start({ streamId }) {
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
  frameTimer = setInterval(grabFrame, 500);
  statusTimer = setInterval(() => toSw({ type: 'status', armed: true, hasAudio, hasVideo, learned: learner.learned, progress: learner.progress }), 1000);
  toSw({ type: 'badge', text: 'Learning…' });
}

async function stop(notify) {
  clearInterval(frameTimer); clearInterval(tickTimer); clearInterval(statusTimer);
  frameTimer = tickTimer = statusTimer = null;
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
  if (msg.type === 'start') start(msg);
  else if (msg.type === 'stop') stop(false);
  else if (msg.type === 'settings') settings = mergeSettings(msg.settings);
  else if (msg.type === 'override' && pipeline) pipeline.override(msg.kind);
  else if (msg.type === 'label' && log) log.event('label', { label: msg.label });
  else if (msg.type === 'exportLog') { sendResponse(log ? log.toJSON() : null); return true; }
  else if (msg.type === 'thumbnail') {
    sendResponse(video.videoWidth ? canvas.toDataURL('image/jpeg', 0.6) : null); return true;
  }
});
