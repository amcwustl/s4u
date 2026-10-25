import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../ext/lib/pipeline.js';
import { Detector } from '../ext/lib/detector.js';
import { Controller } from '../ext/lib/controller.js';
import { Bank, MIN_GAME_SAMPLES } from '../ext/lib/banks.js';
import { SampleLog } from '../ext/lib/log.js';
import { FRAME_W, FRAME_H } from '../ext/lib/vision.js';

const GAME_VEC = Float32Array.from({ length: 521 }, (_, i) => (i === 0 ? 1 : 0));
const AD_VEC = Float32Array.from({ length: 521 }, (_, i) => (i === 5 ? 1 : 0));

/** Fake learner: learned immediately; visibility comes from the frame's first pixel (255 → visible). */
function fakeLearner() {
  return {
    learned: true, progress: 1, resets: 0,
    push() {}, reset() { this.resets++; this.learned = false; },
    visibility(gray) { return this.learned ? { scoreboard: gray[0] / 255, logo: gray[1] / 255, perComponent: [] } : { scoreboard: null, logo: null, perComponent: [] }; },
    components() { return []; },
  };
}
function frame(sb, logo, lum = 100) { const f = new Uint8Array(FRAME_W * FRAME_H).fill(lum); f[0] = sb; f[1] = logo; return f; }
const pcm = (amp) => new Float32Array(16000).fill(amp);

function setup({ classify } = {}) {
  const actions = [];
  const parts = {
    learner: fakeLearner(), detector: new Detector(), controller: new Controller(),
    gameBank: new Bank(), adBank: new Bank(), log: new SampleLog(),
    classify: classify ?? ((p) => (p[0] > 0.5 ? { scores: AD_VEC, speech: 0.3, music: 0.8, silence: 0 } : { scores: GAME_VEC, speech: 0.8, music: 0.1, silence: 0 })),
    onActions: (a) => actions.push(...a),
  };
  return { p: createPipeline(parts), parts, actions };
}

test('a tick with no frames and no audio still produces a sample with null signals', () => {
  const { p, parts } = setup();
  const rec = p.tick(0, null);
  assert.equal(rec.scoreboardVis, null);
  assert.equal(rec.adProb, null);
  assert.equal(rec.verdict.state, 'GAME');
  assert.equal(parts.log.toJSON().samples.length, 1);
});

test('frames are aggregated per second as the max visibility', () => {
  const { p } = setup();
  p.onFrame(frame(255, 0)); p.onFrame(frame(51, 0));
  const rec = p.tick(0, null);
  assert.equal(rec.scoreboardVis, 1);
  assert.equal(rec.logoVis, 0);
});

test('game audio fills the game bank only while the scoreboard is visible', () => {
  const { p, parts } = setup();
  p.onFrame(frame(255, 255)); p.tick(0, pcm(0.1));
  assert.equal(parts.gameBank.size, 1);
  p.onFrame(frame(0, 0)); p.tick(1, pcm(0.1));
  assert.equal(parts.gameBank.size, 1);
});

test('black frame plus near-silence is a black cut', () => {
  const { p } = setup();
  p.onFrame(frame(0, 0, 2));
  const rec = p.tick(0, pcm(0.001));
  assert.equal(rec.blackCut, true);
  p.onFrame(frame(0, 0, 2));
  assert.equal(p.tick(1, pcm(0.1)).blackCut, false);
});

test('end to end: learned game sound, then a break mutes and the ad bank fills after 40 s', () => {
  const { p, parts, actions } = setup();
  for (let t = 0; t < MIN_GAME_SAMPLES + 5; t++) { p.onFrame(frame(255, 255)); p.tick(t, pcm(0.1)); }
  const t0 = MIN_GAME_SAMPLES + 5;
  let muteAt = null;
  for (let t = t0; t < t0 + 60; t++) {
    p.onFrame(frame(0, 0));
    const rec = p.tick(t, pcm(0.9));
    if (muteAt === null && rec.verdict.state === 'COMMERCIAL') muteAt = t;
  }
  assert.equal(muteAt, t0 + 4);
  assert.ok(actions.some(a => a.type === 'spotify' && a.cmd === 'commercial'));
  assert.ok(parts.adBank.size > 0 && parts.adBank.size <= 20, `ad bank ${parts.adBank.size}`);
});

test('scoreboard lost for 60 s while audio still says game triggers a relearn event', () => {
  const { p, parts } = setup();
  for (let t = 0; t < MIN_GAME_SAMPLES; t++) { p.onFrame(frame(255, 255)); p.tick(t, pcm(0.1)); }
  for (let t = MIN_GAME_SAMPLES; t < MIN_GAME_SAMPLES + 60; t++) { p.onFrame(frame(0, 0)); p.tick(t, pcm(0.1)); }
  assert.equal(parts.detector.state, 'GAME');
  assert.equal(parts.learner.resets, 1);
  assert.ok(parts.log.toJSON().events.some(e => e.name === 'relearn'));
});
