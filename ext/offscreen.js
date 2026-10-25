// Offscreen document: holds the tab capture, plays audio through a gain node, samples frames.
const video = document.getElementById('v');
const canvas = document.createElement('canvas');
canvas.width = 32; canvas.height = 18;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let stream = null, audioCtx = null, gain = null, statusTimer = null;

function toSw(msg) {
  return chrome.runtime.sendMessage({ target: 'sw', ...msg }).catch(() => {});
}

function meanLuminance() {
  if (!video.videoWidth) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

async function start({ streamId }) {
  await stop(false);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 640, maxHeight: 360, maxFrameRate: 15 } },
  });
  audioCtx = new AudioContext();
  gain = audioCtx.createGain();
  gain.gain.value = 1;
  if (stream.getAudioTracks().length) {
    audioCtx.createMediaStreamSource(stream).connect(gain);
    gain.connect(audioCtx.destination);
  }
  video.srcObject = stream;
  for (const t of stream.getTracks()) t.onended = () => stop(true);
  statusTimer = setInterval(() => toSw({
    type: 'status', armed: true,
    hasAudio: stream.getAudioTracks().some(t => t.readyState === 'live'),
    hasVideo: stream.getVideoTracks().some(t => t.readyState === 'live') && video.videoWidth > 0,
    luminance: meanLuminance(),
  }), 1000);
}

function setGain(value) {
  if (!gain) return;
  const now = audioCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + 0.3);
}

async function stop(notify) {
  clearInterval(statusTimer); statusTimer = null;
  if (gain) setGain(1);
  if (stream) for (const t of stream.getTracks()) { t.onended = null; t.stop(); }
  stream = null; video.srcObject = null;
  if (audioCtx) { await audioCtx.close().catch(() => {}); audioCtx = null; gain = null; }
  if (notify) toSw({ type: 'status', armed: false });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg);
  else if (msg.type === 'stop') stop(false);
  else if (msg.type === 'setGain') setGain(msg.value);
});
