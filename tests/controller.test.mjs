import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../ext/lib/controller.js';

const C = { state: 'COMMERCIAL', reason: 'audio', goneSec: 5 };
const G = { state: 'GAME', reason: 'scoreboard', goneSec: 0 };
const MUTE = [{ type: 'fadeOut' }, { type: 'spotify', cmd: 'commercial' }, { type: 'badge', text: 'Muted' }];
const UNMUTE = [{ type: 'spotify', cmd: 'game' }, { type: 'fadeIn' }, { type: 'badge', text: 'Game' }];

test('auto COMMERCIAL mutes, auto GAME unmutes with Spotify paused first', () => {
  const c = new Controller();
  assert.deepEqual(c.update(G), []);
  assert.deepEqual(c.update(C), MUTE);
  assert.equal(c.muted, true);
  assert.deepEqual(c.update(C), []);
  assert.deepEqual(c.update(G), UNMUTE);
  assert.equal(c.muted, false);
  assert.deepEqual(c.update(G), []);
});

test('toggleMute while auto-muted unmutes and ignores the rest of this break', () => {
  const c = new Controller();
  c.update(C);
  assert.deepEqual(c.toggleMute(), UNMUTE);
  assert.deepEqual(c.update(C), []);            // rest of the break ignored
  assert.deepEqual(c.update(G), []);            // nothing to unmute
  assert.deepEqual(c.update(C), MUTE);          // next break mutes again
});

test('toggleMute while unmuted is a manual mute until toggled again', () => {
  const c = new Controller();
  c.update(G);
  assert.deepEqual(c.toggleMute(), MUTE);
  assert.equal(c.manual, true);
  assert.deepEqual(c.update(G), []);
  assert.deepEqual(c.toggleMute(), UNMUTE);
  assert.equal(c.manual, false);
});

test('manual mute clears when a commercial ends', () => {
  const c = new Controller();
  c.update(G);
  c.toggleMute();
  assert.deepEqual(c.update(C), []);            // already muted
  assert.deepEqual(c.update(G), UNMUTE);
  assert.equal(c.manual, false);
});

test('togglePause while auto-muted unmutes; verdicts only badge while paused', () => {
  const c = new Controller();
  c.update(C);
  assert.deepEqual(c.togglePause(), [{ type: 'spotify', cmd: 'game' }, { type: 'fadeIn' }, { type: 'badge', text: 'Paused' }]);
  assert.equal(c.paused, true);
  assert.deepEqual(c.update(G), [{ type: 'badge', text: 'Paused' }]);
  assert.deepEqual(c.update(G), []);
  assert.deepEqual(c.update(C), [{ type: 'badge', text: 'Paused' }]);
  assert.equal(c.muted, false);
});

test('resuming during a commercial mutes on the next verdict', () => {
  const c = new Controller();
  c.togglePause();
  c.update(C);
  assert.deepEqual(c.togglePause(), [{ type: 'badge', text: 'Game' }]);
  assert.deepEqual(c.update(C), MUTE);
});

test('shadow mode replaces automatic switching with badges, overrides still act', () => {
  const c = new Controller({ shadow: true });
  assert.deepEqual(c.update(C), [{ type: 'badge', text: 'SHADOW: would mute' }]);
  assert.deepEqual(c.update(C), []);
  assert.deepEqual(c.update(G), [{ type: 'badge', text: 'SHADOW: would unmute' }]);
  assert.deepEqual(c.toggleMute(), MUTE);
  assert.deepEqual(c.toggleMute(), UNMUTE);
});

test('end() unmutes if muted and reports Off', () => {
  const c = new Controller();
  c.update(C);
  assert.deepEqual(c.end(), [{ type: 'spotify', cmd: 'game' }, { type: 'fadeIn' }, { type: 'badge', text: 'Off' }]);
  const c2 = new Controller();
  c2.update(G);
  assert.deepEqual(c2.end(), [{ type: 'badge', text: 'Off' }]);
});
