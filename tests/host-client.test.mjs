import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostClient, BACKOFF_MS } from '../ext/lib/host-client.js';

// Fake chrome.runtime.Port
function fakePort() {
  const port = { posted: [], listeners: { msg: [], disc: [] }, disconnected: false };
  port.postMessage = (m) => port.posted.push(m);
  port.onMessage = { addListener: (f) => port.listeners.msg.push(f) };
  port.onDisconnect = { addListener: (f) => port.listeners.disc.push(f) };
  port.disconnect = () => { port.disconnected = true; };
  port.reply = (m) => port.listeners.msg.forEach(f => f(m));
  port.drop = () => port.listeners.disc.forEach(f => f());
  return port;
}
function fakeTimers() {
  const t = { pending: [], setTimeout(fn, ms) { const id = { fn, ms }; t.pending.push(id); return id; }, clearTimeout(id) { t.pending = t.pending.filter(p => p !== id); } };
  t.fire = () => { const p = t.pending.shift(); p?.fn(); return p?.ms; };
  return t;
}
function setup() {
  const ports = [];
  const timers = fakeTimers();
  const client = createHostClient({ connect: () => { const p = fakePort(); ports.push(p); return p; }, timers });
  return { ports, timers, client };
}

test('send resolves with the host reply', async () => {
  const { ports, client } = setup();
  client.start();
  const p = client.send({ cmd: 'status' });
  assert.deepEqual(ports[0].posted, [{ cmd: 'status' }]);
  ports[0].reply({ ok: true, running: true });
  assert.deepEqual(await p, { ok: true, running: true });
  assert.equal(client.state.connected, true);
});

test('send rejects after 2 s without a reply', async () => {
  const { timers, client } = setup();
  client.start();
  const p = client.send({ cmd: 'game' });
  assert.equal(timers.fire(), 2000);
  await assert.rejects(p, /timeout/);
});

test('reconnects with backoff 1,2,4,8,16,30,30 s and resets on success', () => {
  const { ports, timers, client } = setup();
  client.start();
  const seen = [];
  for (let i = 0; i < 7; i++) { ports.at(-1).drop(); seen.push(timers.fire()); }
  assert.deepEqual(seen, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.deepEqual(BACKOFF_MS, [1000, 2000, 4000, 8000, 16000, 30000]);
  assert.equal(client.state.connected, false);
  ports.at(-1).reply({ ok: true });            // any message marks connected and resets backoff
  ports.at(-1).drop();
  assert.equal(timers.fire(), 1000);
});

test('stop disconnects and never reconnects', () => {
  const { ports, timers, client } = setup();
  client.start();
  client.stop();
  assert.equal(ports[0].disconnected, true);
  assert.equal(timers.pending.length, 0);
  assert.equal(client.state.connected, false);
});

test('send while stopped rejects immediately', async () => {
  const { client } = setup();
  await assert.rejects(client.send({ cmd: 'status' }), /not connected/);
});
