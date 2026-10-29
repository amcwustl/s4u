import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRecorder, testFolderName } from '../ext/lib/test-recorder.js';

class FakeRecorder {
  constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; FakeRecorder.last = this; }
  start(slice) { this.slice = slice; this.state = 'recording'; }
  emit(text) { this.ondataavailable({ data: new Blob([text]) }); }
  stop() { this.emit('tail'); this.state = 'inactive'; queueMicrotask(() => this.onstop()); }
}

function fakeTimers() {
  const pending = new Map(); let id = 0;
  return {
    setTimeout(fn, ms) { pending.set(++id, { fn, ms }); return id; },
    clearTimeout(i) { pending.delete(i); },
    fire() { const [[i, { fn, ms }]] = pending; pending.delete(i); fn(); return ms; },
    get size() { return pending.size; },
  };
}

function setup() {
  const saved = [];
  const stopped = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push('a') }, { stop: () => stopped.push('v') }] };
  const timers = fakeTimers();
  let n = 0;
  const r = createTestRecorder({
    stream, folder: 's4u-test-x', Recorder: FakeRecorder, timers,
    getLog: () => ({ samples: [++n] }),
    save: async (blob, filename) => { const s = { filename, type: blob.type }; saved.push(s); s.text = await blob.text(); },
  });
  return { r, rec: FakeRecorder.last, saved, stopped, timers };
}

test('first part after a minute, then every 15 minutes, each with the latest log', async () => {
  const { rec, saved, timers } = setup();
  assert.equal(rec.slice, 1000);
  rec.emit('hdr'); rec.emit('a');
  assert.equal(timers.fire(), 60_000);
  await new Promise(r => setTimeout(r));
  assert.deepEqual(saved, [
    { filename: 's4u-test-x/part-001.webm', type: 'video/webm', text: 'hdra' },
    { filename: 's4u-test-x/log.json', type: 'application/json', text: '{"samples":[1]}' },
  ]);
  rec.emit('b');
  assert.equal(timers.fire(), 900_000);
  await new Promise(r => setTimeout(r));
  assert.equal(saved[2].filename, 's4u-test-x/part-002.webm');
  assert.equal(saved[2].text, 'b');
  assert.equal(saved[3].text, '{"samples":[2]}');
});

test('stop saves the tail and the final log, stops the tracks, and is safe to call twice', async () => {
  const { r, rec, saved, stopped, timers } = setup();
  rec.emit('hdr');
  const [a, b] = [r.stop(), r.stop()];
  assert.equal(a, b);
  assert.deepEqual(await a, { folder: 's4u-test-x', parts: 1 });
  assert.equal(timers.size, 0);
  assert.deepEqual(saved.map(s => [s.filename, s.text]), [
    ['s4u-test-x/part-001.webm', 'hdrtail'],
    ['s4u-test-x/log.json', '{"samples":[1]}'],
  ]);
  assert.deepEqual(stopped, ['a', 'v']);
});

test('a recorder that already ended on its own (tab closed) still saves on stop', async () => {
  const { r, rec, saved } = setup();
  rec.emit('hdr');
  rec.stop(); // the stream ended: MediaRecorder stops itself
  await r.stop();
  assert.deepEqual(saved.map(s => s.filename), ['s4u-test-x/part-001.webm', 's4u-test-x/log.json']);
});

test('a part with no new video still refreshes log.json', async () => {
  const { rec, saved, timers } = setup();
  timers.fire();
  await new Promise(r => setTimeout(r));
  assert.deepEqual(saved.map(s => s.filename), ['s4u-test-x/log.json']);
  assert.equal(rec.state, 'recording');
});

test('folder name is filesystem-safe', () => {
  assert.equal(testFolderName(new Date('2026-10-29T23:50:01.123Z')), 's4u-test-2026-10-29T23-50-01');
});
