import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Detector, DEFAULTS } from '../ext/lib/detector.js';

const GAME = { scoreboardVis: 0.95, logoVis: 0.9, gameSim: 0.9, adProb: 0.05, speech: 0.8, music: 0.1, blackCut: false };
const AD = { scoreboardVis: 0, logoVis: 0, gameSim: 0.1, adProb: 0.9, speech: 0.3, music: 0.7, blackCut: false };

/** Builds n samples from a partial, with t continuing from `from`. */
function seq(n, partial, from = 0) {
  return Array.from({ length: n }, (_, i) => ({ ...GAME, ...partial, t: from + i }));
}
/** Runs samples through d; returns verdicts with t attached. */
function run(d, samples) { return samples.map(s => ({ ...d.step(s), t: s.t })); }
const firstT = (vs, state) => vs.find(v => v.state === state)?.t;

test('clean break: COMMERCIAL at t=64, GAME when the scoreboard returns', () => {
  const d = new Detector();
  const vs = run(d, [...seq(60, {}), ...seq(20, AD, 60)]);
  assert.equal(firstT(vs, 'COMMERCIAL'), 64);
  assert.equal(vs[64].reason, 'audio');
  const back = d.step({ ...GAME, t: 80 });
  assert.equal(back.state, 'GAME');
});

test('long replay with game audio never mutes', () => {
  const d = new Detector();
  const vs = run(d, [...seq(60, {}), ...seq(45, { scoreboardVis: 0, logoVis: 0, gameSim: 0.85, adProb: 0.1 }, 60)]);
  assert.equal(firstT(vs, 'COMMERCIAL'), undefined);
});

test('black cut shortly after the scoreboard leaves mutes immediately', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  run(d, seq(2, { ...AD, adProb: 0.1 }, 60));
  const v = d.step({ ...AD, adProb: 0.1, blackCut: true, t: 62 });
  assert.equal(v.state, 'COMMERCIAL');
  assert.equal(v.reason, 'black-cut');
});

test('black cut long after the scoreboard left does nothing', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  run(d, seq(30, { scoreboardVis: 0, logoVis: 0, gameSim: 0.85, adProb: 0.1 }, 60));
  const v = d.step({ scoreboardVis: 0, logoVis: 0, gameSim: 0.85, adProb: 0.1, speech: 0.8, music: 0.1, blackCut: true, t: 90 });
  assert.equal(v.state, 'GAME');
});

test('visible logo holds GAME even with ad-like audio', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  const vs = run(d, seq(30, { ...AD, logoVis: 0.9 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), undefined);
  assert.equal(vs.at(-1).goneSec, 0);
});

test('logo alone cannot leave COMMERCIAL', () => {
  const d = new Detector();
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  assert.equal(d.state, 'COMMERCIAL');
  const vs = run(d, seq(20, { ...AD, logoVis: 0.95 }, 70));
  assert.ok(vs.every(v => v.state === 'COMMERCIAL'));
});

test('sustained game audio leaves COMMERCIAL on the 5th sample', () => {
  const d = new Detector();
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const vs = run(d, seq(5, { ...AD, gameSim: 0.8 }, 70));
  assert.deepEqual(vs.map(v => v.state), ['COMMERCIAL', 'COMMERCIAL', 'COMMERCIAL', 'COMMERCIAL', 'GAME']);
  assert.equal(vs[4].reason, 'audio');
});

test('talky ad with intermittent game-like audio stays COMMERCIAL', () => {
  const d = new Detector();
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const sims = [0.8, 0.8, 0.2, 0.8, 0.2, 0.2];
  const vs = run(d, sims.map((gameSim, i) => ({ ...AD, gameSim, t: 70 + i })));
  assert.ok(vs.every(v => v.state === 'COMMERCIAL'));
});

test('a partly visible scoreboard for 3 s resets the gone timer', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  run(d, seq(2, { scoreboardVis: 0, logoVis: 0 }, 60));
  const dips = run(d, seq(3, { scoreboardVis: 0.5, logoVis: 0 }, 62));
  assert.equal(dips.at(-1).goneSec, 0);
  const v = d.step({ ...GAME, scoreboardVis: 0, logoVis: 0, t: 65 });
  assert.equal(v.goneSec, 1);
});

test('ambient sound in the first 30 s gone does not count toward the ad streak', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  const ambient = run(d, seq(10, { ...AD, speech: 0.1, music: 0.1 }, 60));
  assert.ok(ambient.every(v => v.state === 'GAME'));
  const talk = run(d, seq(2, AD, 70));
  assert.deepEqual(talk.map(v => v.state), ['GAME', 'COMMERCIAL']);
});

test('cold start: no audio profile yet, 40 s of absence mutes', () => {
  const d = new Detector();
  run(d, seq(60, { adProb: null, gameSim: null }));
  const vs = run(d, seq(40, { scoreboardVis: 0, logoVis: 0, adProb: null, gameSim: null }, 60));
  assert.ok(vs.slice(0, 39).every(v => v.state === 'GAME'));
  assert.equal(vs[39].state, 'COMMERCIAL');
  assert.equal(vs[39].reason, 'cold-start');
});

test('audio-only mode (no video): 15 s of ad probability mutes, game audio recovers', () => {
  const d = new Detector();
  run(d, seq(60, { scoreboardVis: null, logoVis: null }));
  const vs = run(d, seq(15, { scoreboardVis: null, logoVis: null, gameSim: 0.1, adProb: 0.9 }, 60));
  assert.ok(vs.slice(0, 14).every(v => v.state === 'GAME'));
  assert.equal(vs[14].state, 'COMMERCIAL');
  assert.equal(vs[14].reason, 'audio-only');
  const back = run(d, seq(5, { scoreboardVis: null, logoVis: null, gameSim: 0.8, adProb: 0.1 }, 75));
  assert.equal(back[4].state, 'GAME');
});

test('no audio track: scoreboard-only with the 40 s rule, fast recovery at 0.85', () => {
  const d = new Detector();
  const base = { adProb: null, gameSim: null, speech: 0, music: 0 };
  run(d, seq(60, base));
  const vs = run(d, seq(40, { ...base, scoreboardVis: 0, logoVis: 0 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), 99);
  const back = d.step({ ...GAME, ...base, scoreboardVis: 0.9, t: 100 });
  assert.equal(back.state, 'GAME');
});

test('max commercial length forces GAME', () => {
  const d = new Detector();
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const vs = run(d, seq(240, { ...AD, adProb: 0.9, gameSim: 0.1 }, 70));
  const t = firstT(vs, 'GAME');
  assert.equal(vs.find(v => v.t === t).reason, 'max-commercial');
  assert.equal(t, 64 + 240); // entered COMMERCIAL at t=64
});

test('custom goneSec shifts the clean-break transition', () => {
  const d = new Detector({ goneSec: 5 });
  const vs = run(d, [...seq(60, {}), ...seq(20, AD, 60)]);
  assert.equal(firstT(vs, 'COMMERCIAL'), 66);
  assert.equal(DEFAULTS.goneSec, 3);
});

test('streaky ad audio is caught by a majority vote over the last 10 s', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  const probs = [0.9, 0.6, 0.4, 0.9, 0.6, 0.9, 0.6, 0.4, 0.9, 0.6, 0.6, 0.4, 0.9];
  const vs = run(d, probs.map((adProb, i) => ({ ...AD, adProb, t: 60 + i })));
  const t = firstT(vs, 'COMMERCIAL');
  assert.equal(vs.find(v => v.t === t).reason, 'audio-vote');
  assert.equal(t, 70); // votes start at t=63 (goneSec > 3); the 7th hit ≥ 0.5 lands at t=70
});

test('a short produced package (8 s of mildly ad-like audio) never mutes', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  const vs = run(d, seq(8, { ...AD, adProb: 0.6 }, 60));
  assert.ok(vs.every(v => v.state === 'GAME'));
  const back = run(d, seq(3, {}, 68));
  assert.ok(back.every(v => v.state === 'GAME'));
});

test('announcer-level speech (0.45) is not ambient: ambientMax is 0.2', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  // announcer-level speech (0.45) with ad-like audio must count toward the streak
  const vs = run(d, seq(6, { ...AD, speech: 0.45, music: 0.0, adProb: 0.9 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), 64);
  assert.equal(DEFAULTS.ambientMax, 0.2);
});
