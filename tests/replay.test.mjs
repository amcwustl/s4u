import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replay, parseOverrides } from '../tools/replay.mjs';

const log = JSON.parse(readFileSync(new URL('./fixtures/mini-log.json', import.meta.url), 'utf8'));

test('replay reports transitions and scores against labels', () => {
  const r = replay(log, { goneSec: 3 }); // the mini log was built for the original 3 s threshold
  assert.deepEqual(r.transitions.map(x => [x.t, x.state]), [[64, 'COMMERCIAL'], [100, 'GAME']]);
  assert.equal(r.adHeardSec, 4);
  assert.equal(r.gameMutedSec, 0);
});

test('threshold overrides shift the transition', () => {
  const r = replay(log, { goneSec: 10 });
  assert.equal(r.transitions[0].t, 71);
  assert.equal(r.adHeardSec, 11);
});

test('parseOverrides reads --set key=value pairs as numbers', () => {
  assert.deepEqual(parseOverrides(['x.json', '--set', 'goneSec=5', '--set', 'adProb=0.8']), { file: 'x.json', overrides: { goneSec: 5, adProb: 0.8 } });
});

test('labels without an explicit t fall back to timestamps relative to start', () => {
  const l2 = structuredClone(log);
  for (const e of l2.events) delete e.data.t;
  assert.equal(replay(l2, { goneSec: 3 }).adHeardSec, 4);
});
