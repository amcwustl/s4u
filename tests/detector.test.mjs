import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Detector, DEFAULTS } from '../ext/lib/detector.js';

const GAME = { scoreboardVis: 0.95, logoVis: 0.9, gameSim: 0.9, adProb: 0.05, speech: 0.8, music: 0.1, blackCut: false };
const AD = { scoreboardVis: 0, logoVis: 0, gameSim: 0.1, adProb: 0.9, speech: 0.3, music: 0.7, blackCut: false };

// Most tests below exercise the audio-entry rules themselves, at the original 3 s threshold.
const FAST = { goneSec: 3 };

/** Builds n samples from a partial, with t continuing from `from`. */
function seq(n, partial, from = 0) {
  return Array.from({ length: n }, (_, i) => ({ ...GAME, ...partial, t: from + i }));
}
/** Runs samples through d; returns verdicts with t attached. */
function run(d, samples) { return samples.map(s => ({ ...d.step(s), t: s.t })); }
const firstT = (vs, state) => vs.find(v => v.state === state)?.t;

test('clean break: COMMERCIAL at t=64, GAME when the scoreboard returns', () => {
  const d = new Detector(FAST);
  const vs = run(d, [...seq(60, {}), ...seq(20, AD, 60)]);
  assert.equal(firstT(vs, 'COMMERCIAL'), 64);
  assert.equal(vs[64].reason, 'audio');
  const back = d.step({ ...GAME, t: 80 });
  assert.equal(back.state, 'GAME');
});

test('long replay with game audio never mutes', () => {
  const d = new Detector(FAST);
  const vs = run(d, [...seq(60, {}), ...seq(45, { scoreboardVis: 0, logoVis: 0, gameSim: 0.85, adProb: 0.1 }, 60)]);
  assert.equal(firstT(vs, 'COMMERCIAL'), undefined);
});

test('black cut shortly after the scoreboard leaves mutes immediately', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  run(d, seq(2, { ...AD, adProb: 0.1 }, 60));
  const v = d.step({ ...AD, adProb: 0.1, blackCut: true, t: 62 });
  assert.equal(v.state, 'COMMERCIAL');
  assert.equal(v.reason, 'black-cut');
});

test('black cut long after the scoreboard left still mutes: play never cuts to black', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  run(d, seq(70, { scoreboardVis: 0, logoVis: 0, gameSim: 0.85, adProb: 0.1 }, 60));
  const v = d.step({ scoreboardVis: 0, logoVis: 0, gameSim: 0.85, adProb: 0.1, speech: 0.8, music: 0.1, blackCut: true, t: 130 });
  assert.equal(v.state, 'COMMERCIAL');
  assert.equal(v.reason, 'black-cut');
});

test('black cut while the scoreboard is still visible does nothing', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  const v = d.step({ ...GAME, blackCut: true, t: 60 });
  assert.equal(v.state, 'GAME');
  assert.ok(run(d, seq(5, {}, 61)).every(x => x.state === 'GAME'));
});

test('a cut mid-second (scoreboard still in that second\'s other frame) mutes on the next second', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  assert.equal(d.step({ ...GAME, blackCut: true, t: 60 }).state, 'GAME');
  const v = d.step({ ...AD, adProb: 0.1, blackCut: false, t: 61 });
  assert.equal(v.state, 'COMMERCIAL');
  assert.equal(v.reason, 'black-cut');
});

test('ad-to-ad black cut 37 s after the scoreboard left still mutes (live log 2026-10-25, t=220)', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  // A talking ad: adProb hovers below the vote line, so neither audio rule fires before the cut.
  run(d, seq(36, { scoreboardVis: 0.3, logoVis: 0.3, gameSim: 0.5, adProb: 0.4, speech: 0.45, music: 0.02 }, 60));
  const v = d.step({ scoreboardVis: 0.3, logoVis: 0.3, gameSim: 0.5, adProb: 0.4, speech: 0.45, music: 0.02, blackCut: true, t: 96 });
  assert.equal(v.state, 'COMMERCIAL');
  assert.equal(v.reason, 'black-cut');
});

test('visible logo holds GAME even with ad-like audio', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  const vs = run(d, seq(30, { ...AD, logoVis: 0.9 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), undefined);
  assert.equal(vs.at(-1).goneSec, 0);
});

test('logo alone cannot leave COMMERCIAL', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  assert.equal(d.state, 'COMMERCIAL');
  const vs = run(d, seq(20, { ...AD, logoVis: 0.95 }, 70));
  assert.ok(vs.every(v => v.state === 'COMMERCIAL'));
});

test('sustained game audio leaves COMMERCIAL on the 10th speaking sample (10 of 12)', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const vs = run(d, seq(10, { ...AD, gameSim: 0.8 }, 70));
  assert.ok(vs.slice(0, 9).every(v => v.state === 'COMMERCIAL'));
  assert.equal(vs[9].state, 'GAME');
  assert.equal(vs[9].reason, 'audio');
  assert.equal(DEFAULTS.recoverSimHits, 10); assert.equal(DEFAULTS.recoverSimWindow, 12);
});

test('a 30 s talking ad that sounds like the game for 8 of 12 s stays COMMERCIAL', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  // live log 2026-10-25 18:11, t=267-276: .94 .70 .86 .89 1 1 .78 .41 .62 .70 ...
  const sims = [0.94, 0.70, 0.86, 0.89, 1, 1, 0.78, 0.41, 0.62, 0.70, 0.34, 0.38, 0.08, 0.27, 0.09, 0.24];
  const vs = run(d, sims.map((gameSim, i) => ({ ...AD, gameSim, speech: 0.3, music: 0.05, t: 70 + i })));
  assert.ok(vs.every(v => v.state === 'COMMERCIAL'));
});

test('scoreboard hovering at 0.42 inside a break never recovers; 0.5 for 3 frames does', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const hover = run(d, seq(6, { ...AD, scoreboardVis: 0.42 }, 70));
  assert.ok(hover.every(v => v.state === 'COMMERCIAL'));
  const half = run(d, seq(3, { ...AD, scoreboardVis: 0.5 }, 76));
  assert.deepEqual(half.map(v => v.state), ['COMMERCIAL', 'COMMERCIAL', 'GAME']);
  assert.equal(half[2].reason, 'scoreboard');
  assert.equal(DEFAULTS.recoverVisSlow, 0.5);
});

test('flap guard: an audio recovery that re-mutes within 20 s locks audio recovery until the scoreboard returns', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const talk = run(d, seq(10, { ...AD, gameSim: 0.9 }, 70));
  assert.equal(talk[9].state, 'GAME'); assert.equal(talk[9].reason, 'audio');
  const remute = run(d, seq(6, AD, 80));                       // music ad 6 s later: fooled once
  assert.equal(remute.at(-1).state, 'COMMERCIAL');
  const talkAgain = run(d, seq(30, { ...AD, gameSim: 0.95 }, 86));
  assert.ok(talkAgain.every(v => v.state === 'COMMERCIAL'), 'audio alone may not unmute again this break');
  const sb = d.step({ ...AD, scoreboardVis: 0.9, t: 116 });
  assert.equal(sb.state, 'GAME'); assert.equal(sb.reason, 'scoreboard');
  // guard clears with the scoreboard: the next break may recover on audio again
  run(d, seq(10, AD, 117));
  const later = run(d, seq(10, { ...AD, gameSim: 0.9 }, 127));
  assert.equal(later[9].state, 'GAME'); assert.equal(later[9].reason, 'audio');
  assert.equal(DEFAULTS.flapGuardSec, 20);
});

test('flap guard does not apply after a scoreboard recovery, nor in audio-only mode', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  assert.equal(d.step({ ...GAME, t: 70 }).reason, 'scoreboard');
  run(d, seq(6, AD, 71));                                      // re-mute 6 s after a *scoreboard* recovery
  const talk = run(d, seq(10, { ...AD, gameSim: 0.9 }, 77));
  assert.equal(talk[9].state, 'GAME');
  const a = new Detector(FAST);
  const blind = { scoreboardVis: null, logoVis: null };
  run(a, [...seq(60, blind), ...seq(15, { ...blind, gameSim: 0.1, adProb: 0.9 }, 60)]);
  run(a, seq(10, { ...blind, gameSim: 0.9, adProb: 0.1 }, 75));
  assert.equal(a.state, 'GAME');
  run(a, seq(15, { ...blind, gameSim: 0.1, adProb: 0.9 }, 85));
  assert.equal(a.state, 'COMMERCIAL');
  run(a, seq(10, { ...blind, gameSim: 0.9, adProb: 0.1 }, 100));
  assert.equal(a.state, 'GAME', 'without video, audio is the only way back');
});

test('quiet ad seconds (ambient: no speech, no music) never count toward audio recovery', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  // Live log 2026-10-25 t=236-248: a near-silent ad scored gameSim 0.8-1.0 and un-muted the break.
  const quiet = run(d, seq(12, { ...AD, gameSim: 0.95, speech: 0.05, music: 0.1 }, 70));
  assert.ok(quiet.every(v => v.state === 'COMMERCIAL'));
  const talk = run(d, seq(10, { ...AD, gameSim: 0.8, speech: 0.4, music: 0.02 }, 82));
  assert.ok(talk.slice(0, 9).every(v => v.state === 'COMMERCIAL'));
  assert.equal(talk[9].state, 'GAME');
});

test('talky ad with intermittent game-like audio stays COMMERCIAL', () => {
  const d = new Detector(FAST);
  run(d, [...seq(60, {}), ...seq(10, AD, 60)]);
  const sims = [0.8, 0.8, 0.2, 0.8, 0.2, 0.2];
  const vs = run(d, sims.map((gameSim, i) => ({ ...AD, gameSim, t: 70 + i })));
  assert.ok(vs.every(v => v.state === 'COMMERCIAL'));
});

test('a partly visible scoreboard for 3 s resets the gone timer', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  run(d, seq(2, { scoreboardVis: 0, logoVis: 0 }, 60));
  const dips = run(d, seq(3, { scoreboardVis: 0.5, logoVis: 0 }, 62));
  assert.equal(dips.at(-1).goneSec, 0);
  const v = d.step({ ...GAME, scoreboardVis: 0, logoVis: 0, t: 65 });
  assert.equal(v.goneSec, 1);
});

test('ambient sound in the first 30 s gone does not count toward the ad streak', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  const ambient = run(d, seq(10, { ...AD, speech: 0.1, music: 0.1 }, 60));
  assert.ok(ambient.every(v => v.state === 'GAME'));
  const talk = run(d, seq(2, AD, 70));
  assert.deepEqual(talk.map(v => v.state), ['GAME', 'COMMERCIAL']);
});

test('cold start: no audio profile yet, 40 s of absence mutes', () => {
  const d = new Detector(FAST);
  run(d, seq(60, { adProb: null, gameSim: null }));
  const vs = run(d, seq(40, { scoreboardVis: 0, logoVis: 0, adProb: null, gameSim: null }, 60));
  assert.ok(vs.slice(0, 39).every(v => v.state === 'GAME'));
  assert.equal(vs[39].state, 'COMMERCIAL');
  assert.equal(vs[39].reason, 'cold-start');
});

test('audio-only mode (no video): sustained ad probability mutes after 12 s, game audio recovers', () => {
  const d = new Detector(FAST);
  run(d, seq(60, { scoreboardVis: null, logoVis: null }));
  const vs = run(d, seq(15, { scoreboardVis: null, logoVis: null, gameSim: 0.1, adProb: 0.9 }, 60));
  assert.ok(vs.slice(0, 9).every(v => v.state === 'GAME'));
  assert.equal(vs[9].state, 'COMMERCIAL');
  assert.equal(vs[9].reason, 'audio-only-vote');
  const back = run(d, seq(10, { scoreboardVis: null, logoVis: null, gameSim: 0.8, adProb: 0.1 }, 75));
  assert.equal(back[9].state, 'GAME');
});

test('no audio track: scoreboard-only with the 40 s rule, fast recovery at 0.85', () => {
  const d = new Detector(FAST);
  const base = { adProb: null, gameSim: null, speech: 0, music: 0 };
  run(d, seq(60, base));
  const vs = run(d, seq(40, { ...base, scoreboardVis: 0, logoVis: 0 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), 99);
  const back = d.step({ ...GAME, ...base, scoreboardVis: 0.9, t: 100 });
  assert.equal(back.state, 'GAME');
});

test('max commercial length forces GAME', () => {
  const d = new Detector(FAST);
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
  assert.equal(DEFAULTS.goneSec, 45);
});

test('default: ad-like announcer audio while the bug is off for 40 s (live kick, stat graphic) never mutes', () => {
  const d = new Detector();
  run(d, seq(60, {}));
  const vs = run(d, seq(40, { scoreboardVis: 0.2, logoVis: 0.5, adProb: 1, gameSim: 0.3, speech: 0.45, music: 0.02 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), undefined);
});

test('default: a black cut mutes at once; audio alone only once the bug has been gone 45 s', () => {
  const cut = new Detector();
  run(cut, seq(60, {}));
  run(cut, seq(2, AD, 60));
  assert.equal(cut.step({ ...AD, blackCut: true, t: 62 }).reason, 'black-cut');

  const d = new Detector();
  const vs = run(d, [...seq(60, {}), ...seq(60, AD, 60)]);
  assert.equal(firstT(vs, 'COMMERCIAL'), 106);
  assert.equal(vs[106].reason, 'audio');
});

test('mildly ad-like audio (never ≥ 0.75) is caught by a majority vote, but only once the scoreboard has been gone 10 s', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  const vs = run(d, seq(20, { ...AD, adProb: 0.6 }, 60));
  const t = firstT(vs, 'COMMERCIAL');
  assert.equal(vs.find(v => v.t === t).reason, 'audio-vote');
  assert.equal(t, 74); // votes start at t=69 (goneSec ≥ 10); the 6th hit lands at t=74
  assert.equal(DEFAULTS.adVoteGoneSec, 10);
});

test('nine seconds of mildly ad-like audio with the scoreboard gone never votes', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  const vs = run(d, seq(9, { ...AD, adProb: 0.6 }, 60));
  assert.ok(vs.every(v => v.state === 'GAME'));
});

test('a short produced package (8 s of mildly ad-like audio) never mutes', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  const vs = run(d, seq(8, { ...AD, adProb: 0.6 }, 60));
  assert.ok(vs.every(v => v.state === 'GAME'));
  const back = run(d, seq(3, {}, 68));
  assert.ok(back.every(v => v.state === 'GAME'));
});

test('announcer-level speech (0.45) is not ambient: ambientMax is 0.2', () => {
  const d = new Detector(FAST);
  run(d, seq(60, {}));
  // announcer-level speech (0.45) with ad-like audio must count toward the streak
  const vs = run(d, seq(6, { ...AD, speech: 0.45, music: 0.0, adProb: 0.9 }, 60));
  assert.equal(firstT(vs, 'COMMERCIAL'), 64);
  assert.equal(DEFAULTS.ambientMax, 0.2);
});

test('audio-only mode also mutes on a majority vote: 10 of the last 15 s with adProb ≥ 0.5', () => {
  const d = new Detector(FAST);
  run(d, seq(60, { scoreboardVis: null, logoVis: null }));
  // never 15 consecutive ≥ 0.75, but 12 of 15 ≥ 0.5
  const probs = [0.6, 0.9, 0.4, 0.6, 0.8, 0.6, 0.3, 0.7, 0.9, 0.6, 0.6, 0.5, 0.8, 0.4, 0.6, 0.7];
  const vs = run(d, probs.map((adProb, i) => ({ ...AD, scoreboardVis: null, logoVis: null, adProb, t: 60 + i })));
  const t = firstT(vs, 'COMMERCIAL');
  assert.equal(vs.find(v => v.t === t).reason, 'audio-only-vote');
  assert.equal(t, 60 + 11); // 10th hit ≥ 0.5 lands on the 12th sample
  assert.equal(DEFAULTS.audioOnlyVoteHits, 10);
});

test('audio-only mode: scattered mild ad probability during play never votes', () => {
  const d = new Detector(FAST);
  run(d, seq(60, { scoreboardVis: null, logoVis: null }));
  const probs = [0.5, 0.1, 0.0, 0.0, 0.4, 0.1, 0.4, 0.2, 0.4, 0.5, 0.5, 0.8, 0.3, 0.5, 0.1, 0.2, 0.3];
  const vs = run(d, probs.map((adProb, i) => ({ ...AD, scoreboardVis: null, logoVis: null, adProb, gameSim: 1 - adProb, t: 60 + i })));
  assert.ok(vs.every(v => v.state === 'GAME'));
});
