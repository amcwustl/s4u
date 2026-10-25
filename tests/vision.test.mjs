import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScoreboardLearner, toGray, meanLuminance, FRAME_W, FRAME_H } from '../ext/lib/vision.js';

const W = FRAME_W, H = FRAME_H;
// Deterministic PRNG so the fixed graphics are stable across frames and runs.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const SCOREBOARD = { x: 20, y: 150, w: 60, h: 20 };
const LOGO = { x: 290, y: 10, w: 16, h: 16 };
// Fixed high-contrast textures (like text on a bar): same every frame.
const texture = (r, seed) => { const g = rng(seed); return Uint8Array.from({ length: r.w * r.h }, () => (g() < 0.5 ? 0 : 255)); };
const SB_TEX = texture(SCOREBOARD, 7), LOGO_TEX = texture(LOGO, 11);

function paint(frame, r, tex) {
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) frame[(r.y + j) * W + r.x + i] = tex[j * r.w + i];
}
function noiseFrame(g) { return Uint8Array.from({ length: W * H }, () => Math.floor(g() * 256)); }
function gameFrame(g) { const f = noiseFrame(g); paint(f, SCOREBOARD, SB_TEX); paint(f, LOGO, LOGO_TEX); return f; }

function learned() {
  const g = rng(1), L = new ScoreboardLearner();
  for (let i = 0; i < 61; i++) L.push(gameFrame(g));
  return { L, g };
}

test('learns two fixed graphics from 60 noisy frames; the larger is the scoreboard', () => {
  const { L } = learned();
  assert.equal(L.learned, true);
  const comps = L.components();
  assert.equal(comps.length, 2);
  const sb = comps.find(c => c.kind === 'scoreboard');
  assert.ok(Math.abs(sb.x - SCOREBOARD.x) <= 2 && Math.abs(sb.y - SCOREBOARD.y) <= 2, `scoreboard at ${sb.x},${sb.y}`);
  assert.ok(Math.abs(sb.w - SCOREBOARD.w) <= 4 && Math.abs(sb.h - SCOREBOARD.h) <= 4);
  assert.equal(comps.filter(c => c.kind === 'logo').length, 1);
});

test('visibility is high with the graphics present and low without', () => {
  const { L, g } = learned();
  const present = L.visibility(gameFrame(g));
  assert.ok(present.scoreboard >= 0.9, `present ${present.scoreboard}`);
  assert.ok(present.logo >= 0.9);
  const absent = L.visibility(new Uint8Array(W * H).fill(128));
  assert.ok(absent.scoreboard <= 0.2, `absent ${absent.scoreboard}`);
  assert.ok(absent.logo <= 0.2);
});

test('frozen (identical) frames do not advance learning', () => {
  const g = rng(3), L = new ScoreboardLearner();
  for (let i = 0; i < 11; i++) L.push(gameFrame(g));
  const before = L.progress;
  const frozen = gameFrame(g);
  for (let i = 0; i < 30; i++) L.push(frozen);
  assert.ok(Math.abs(L.progress - before) < 1e-9 + 1 / 60, 'frozen run counted at most once');
  assert.equal(L.learned, false);
});

test('a fully static video never learns anything', () => {
  const L = new ScoreboardLearner();
  const f = new Uint8Array(W * H).fill(90);
  for (let i = 0; i < 200; i++) L.push(f);
  assert.equal(L.learned, false);
  assert.equal(L.progress, 0);
});

test('unlearned visibility is null; reset clears learning', () => {
  const L = new ScoreboardLearner();
  assert.deepEqual(L.visibility(new Uint8Array(W * H)), { scoreboard: null, logo: null, perComponent: [] });
  const { L: L2 } = learned();
  L2.reset();
  assert.equal(L2.learned, false);
  assert.equal(L2.progress, 0);
});

test('toGray and meanLuminance', () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const g = toGray(rgba, 2, 1);
  assert.ok(Math.abs(g[0] - 76) <= 1);
  assert.ok(Math.abs(g[1] - 150) <= 1);
  assert.equal(meanLuminance(new Uint8Array(10)), 0);
  assert.equal(meanLuminance(Uint8Array.from([100, 200])), 150);
});
