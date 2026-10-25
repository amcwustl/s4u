import { ScoreboardLearner, toGray, FRAME_W, FRAME_H } from '../ext/lib/vision.js';
import { Detector } from '../ext/lib/detector.js';
import { Controller } from '../ext/lib/controller.js';
import { Bank } from '../ext/lib/banks.js';
import { SampleLog } from '../ext/lib/log.js';
import { createPipeline } from '../ext/lib/pipeline.js';
import { createAudioFeatures } from '../ext/lib/audio-features.js';
import { drawChart } from '../ext/lib/chart.js';
import { replay } from '../ext/lib/replay.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const out = $('out'); const log = (s) => { out.textContent += '\n' + s; };
const video = $('v'), fctx = $('frame').getContext('2d', { willReadFrequently: true });
let lastLog = null;

async function loadAudio16k(src) {
  const buf = await (src instanceof Blob ? src.arrayBuffer() : (await fetch(src)).arrayBuffer());
  const octx = new OfflineAudioContext(1, 16000, 16000);
  const decoded = await octx.decodeAudioData(buf);
  return decoded.getChannelData(0);
}
function seek(t) {
  return new Promise((res) => { video.onseeked = () => res(); video.currentTime = t; });
}
function parseLabels(s) {
  return (s ?? '').split(',').filter(Boolean).map(x => { const [t, label] = x.split(':'); return { t: Number(t), label }; });
}

/** Frame source: either raw 2 fps gray frames (headless-safe) or a <video> we seek through. */
async function frameSource({ framesSrc, videoSrc }) {
  const FRAME_BYTES = FRAME_W * FRAME_H;
  if (framesSrc) {
    const buf = new Uint8Array(await (await fetch(framesSrc)).arrayBuffer());
    const n = Math.floor(buf.length / FRAME_BYTES);
    return {
      seconds: Math.floor(n / 2), describe: `raw frames: ${n} @ 2 fps`,
      async framesAt(t) { const out = []; for (const k of [2 * t, 2 * t + 1]) if (k < n) out.push(buf.subarray(k * FRAME_BYTES, (k + 1) * FRAME_BYTES)); return out; },
      draw(gray) { const img = fctx.createImageData(FRAME_W, FRAME_H); for (let i = 0; i < gray.length; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = gray[i]; img.data[4 * i + 3] = 255; } fctx.putImageData(img, 0, 0); },
    };
  }
  video.src = videoSrc instanceof Blob ? URL.createObjectURL(videoSrc) : videoSrc;
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('video failed')); });
  return {
    seconds: Math.floor(video.duration), describe: `video ${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(1)} s`,
    async framesAt(t) {
      const out = [];
      for (const off of [0.0, 0.5]) { await seek(t + off); fctx.drawImage(video, 0, 0, FRAME_W, FRAME_H); out.push(toGray(fctx.getImageData(0, 0, FRAME_W, FRAME_H).data, FRAME_W, FRAME_H)); }
      return out;
    },
    draw() {},
  };
}
async function loadPcm({ pcmSrc, audioSrc }) {
  if (pcmSrc) return new Float32Array(await (await fetch(pcmSrc)).arrayBuffer());
  return loadAudio16k(audioSrc);
}

async function run({ videoSrc, audioSrc, framesSrc, pcmSrc }) {
  out.textContent = 'loading…';
  const base = new URL('../ext', location.href).href;
  const af = await createAudioFeatures(base);
  const [pcmAll, frames] = await Promise.all([loadPcm({ pcmSrc, audioSrc }), frameSource({ framesSrc, videoSrc })]);
  const seconds = Math.min(frames.seconds, Math.floor(pcmAll.length / 16000));
  log(`${frames.describe}; audio ${(pcmAll.length / 16000).toFixed(1)} s; running ${seconds} s`);

  const learner = new ScoreboardLearner(), sampleLog = new SampleLog();
  const labels = parseLabels(q.get('labels'));
  for (const l of labels) sampleLog.events.push({ name: 'label', data: l, at: new Date().toISOString() });
  const pipeline = createPipeline({
    learner, detector: new Detector(), controller: new Controller({ shadow: false }),
    gameBank: new Bank(), adBank: new Bank(), log: sampleLog,
    classify: (p) => af.classify(p), onActions: () => {}, opts: { keepScores: q.get('keep') !== '0' },
  });
  const records = [];
  const t0 = performance.now();
  for (let t = 0; t < seconds; t++) {
    const grays = await frames.framesAt(t);
    for (const g of grays) pipeline.onFrame(g);
    if (grays.length) frames.draw(grays[0]);
    const rec = pipeline.tick(t, pcmAll.subarray(t * 16000, (t + 1) * 16000));
    records.push(rec);
    if (t % 5 === 0) {
      drawChart($('chart'), records, { windowSec: seconds });
      for (const el of document.querySelectorAll('.thumb .c')) el.remove();
      if (learner.learned) for (const c of learner.components()) {
        const d = document.createElement('div'); d.className = `c ${c.kind}`;
        Object.assign(d.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
        $('thumb').appendChild(d);
      }
      out.textContent = `t=${t}/${seconds}  state=${rec.verdict.state}  sb=${rec.scoreboardVis?.toFixed(2) ?? '—'}  sim=${rec.gameSim?.toFixed(2) ?? '—'}  ad=${rec.adProb?.toFixed(2) ?? '—'}  learned=${learner.learned}`;
      await new Promise(r => setTimeout(r, 0));
    }
  }
  drawChart($('chart'), records, { windowSec: seconds });
  lastLog = sampleLog.toJSON(); window.__lastLog = lastLog;
  const r = replay(lastLog);
  const comps = learner.components();
  const summary = {
    seconds, elapsedMs: Math.round(performance.now() - t0), learned: learner.learned, components: comps,
    transitions: r.transitions, adHeardSec: r.adHeardSec, gameMutedSec: r.gameMutedSec,
    firstLearnedAt: records.find(x => x.learned)?.t ?? null,
    firstAdProbAt: records.find(x => x.adProb !== null)?.t ?? null,
  };
  window.__result = summary;
  out.textContent = JSON.stringify(summary, null, 2);
  document.title = 'FIXTURE DONE';
}

$('run').onclick = () => run({ videoSrc: $('vfile').files[0], audioSrc: $('afile').files[0] }).catch(e => { log('ERROR ' + e.message); document.title = 'FIXTURE ERROR'; });
$('export').onclick = () => {
  if (!lastLog) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(lastLog)], { type: 'application/json' }));
  a.download = 'fixture-log.json'; a.click();
};
if ((q.get('video') || q.get('frames')) && (q.get('audio') || q.get('pcm'))) {
  run({ videoSrc: q.get('video'), audioSrc: q.get('audio'), framesSrc: q.get('frames'), pcmSrc: q.get('pcm') })
    .catch(e => { log('ERROR ' + e.message); window.__error = e.message + '\n' + e.stack; document.title = 'FIXTURE ERROR'; });
}
