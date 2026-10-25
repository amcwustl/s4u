import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SampleLog } from '../ext/lib/log.js';

test('ring buffer caps samples at max, keeping the newest', () => {
  const log = new SampleLog(3);
  for (let t = 0; t < 5; t++) log.push({ t });
  assert.deepEqual(log.toJSON().samples.map(s => s.t), [2, 3, 4]);
});

test('toJSON round-trips through JSON and carries events', () => {
  const log = new SampleLog();
  log.push({ t: 0, scoreboardVis: 0.9 });
  log.event('label', { label: 'ad' });
  const j = JSON.parse(JSON.stringify(log.toJSON()));
  assert.equal(j.version, 1);
  assert.ok(!Number.isNaN(Date.parse(j.started)));
  assert.equal(j.samples.length, 1);
  assert.equal(j.events[0].name, 'label');
  assert.deepEqual(j.events[0].data, { label: 'ad' });
  assert.equal(typeof j.events[0].at, 'string');
});
