import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, Bank, gameSimilarity, adProbability, MIN_GAME_SAMPLES, Z_SCALE } from '../ext/lib/banks.js';

const v = (...xs) => Float32Array.from(xs);
const fill = (bank, vec, n) => { for (let i = 0; i < n; i++) bank.add(vec); };

test('cosine: identical 1, orthogonal 0, zero vector 0', () => {
  assert.ok(Math.abs(cosine(v(1, 2, 3), v(1, 2, 3)) - 1) < 1e-6);
  assert.equal(cosine(v(1, 0), v(0, 1)), 0);
  assert.equal(cosine(v(0, 0), v(1, 1)), 0);
});

test('Bank evicts the oldest past maxSize and centroid is the mean', () => {
  const b = new Bank(2);
  b.add(v(1, 0)); b.add(v(0, 1)); b.add(v(0, 3));
  assert.equal(b.size, 2);
  assert.deepEqual(Array.from(b.centroid()), [0, 2]);
});

test('empty Bank: centroid null, nearest -1', () => {
  const b = new Bank();
  assert.equal(b.centroid(), null);
  assert.equal(b.nearest(v(1, 0)), -1);
});

test('nearest is the max cosine over members', () => {
  const b = new Bank();
  b.add(v(1, 0)); b.add(v(0, 1));
  assert.ok(Math.abs(b.nearest(v(0, 5)) - 1) < 1e-6);
});

test('gameSimilarity is null below MIN_GAME_SAMPLES and ~1 at the centroid', () => {
  assert.equal(MIN_GAME_SAMPLES, 20);
  const g = new Bank();
  fill(g, v(1, 1, 0), MIN_GAME_SAMPLES - 1);
  assert.equal(gameSimilarity(g, v(1, 1, 0)), null);
  g.add(v(1, 1, 0));
  assert.ok(gameSimilarity(g, v(1, 1, 0)) > 0.999);
});

test('adProbability with no ad bank is 1 - gameSimilarity', () => {
  const g = new Bank(), a = new Bank();
  fill(g, v(1, 0), MIN_GAME_SAMPLES);
  const x = v(1, 1);
  assert.ok(Math.abs(adProbability(g, a, x) - (1 - gameSimilarity(g, x))) < 1e-6);
  assert.equal(adProbability(new Bank(), a, x), null);
});

test('adProbability is high for a vector in the ad bank far from the game', () => {
  const g = new Bank(), a = new Bank();
  fill(g, v(1, 0, 0), MIN_GAME_SAMPLES);
  const ad = v(0, 0, 1);
  a.add(ad);
  assert.ok(adProbability(g, a, ad) > 0.9);
});

test('adProbability is low for a vector in the game bank', () => {
  const g = new Bank(), a = new Bank();
  const game = v(1, 0, 0);
  fill(g, game, MIN_GAME_SAMPLES);
  a.add(v(0, 0, 1));
  assert.ok(adProbability(g, a, game) < 0.15);
});

test('results are clamped to [0,1]', () => {
  const g = new Bank(), a = new Bank();
  fill(g, v(1, 0), MIN_GAME_SAMPLES);
  a.add(v(-1, 0));
  const p = adProbability(g, a, v(-1, 0));
  assert.ok(p >= 0 && p <= 1);
});

test('similarity is a z-score against the bank\'s own spread: 2 sd below the mean is adProb 0.5', () => {
  const g = new Bank();
  // bank members spread around a centroid so sd > 0
  const base = [1, 1, 1, 1];
  for (let i = 0; i < 40; i++) g.add(v(...base.map((x, k) => x + (k === i % 4 ? 0.3 : 0))));
  const { mu, sd } = g.stats();
  assert.ok(sd > 0);
  const target = mu - 2 * sd;
  // find a vector whose cosine to the centroid is ≈ target by rotating away from the centroid
  const c = g.centroid();
  const probe = Float32Array.from(c); probe[0] += 10; // far off-axis
  const z = g.z(probe);
  assert.ok(z > 2, `z ${z}`);
  assert.ok(Math.abs(adProbability(g, new Bank(), probe) - Math.min(1, z / Z_SCALE)) < 1e-6);
  assert.ok(Math.abs(gameSimilarity(g, probe) - Math.max(0, 1 - z / Z_SCALE)) < 1e-6);
  assert.equal(Z_SCALE, 4);
});
