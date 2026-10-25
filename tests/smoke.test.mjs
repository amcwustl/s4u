import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../ext/manifest.json', import.meta.url), 'utf8'));

test('manifest is MV3 with required permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  for (const p of ['tabCapture', 'offscreen', 'nativeMessaging', 'storage', 'scripting', 'activeTab']) {
    assert.ok(manifest.permissions.includes(p), `missing permission ${p}`);
  }
});

test('manifest declares the two hotkeys', () => {
  assert.equal(manifest.commands['toggle-mute'].suggested_key.default, 'Alt+Shift+M');
  assert.equal(manifest.commands['toggle-pause'].suggested_key.default, 'Alt+Shift+P');
});

test('manifest pins its extension ID with a key', () => {
  assert.equal(typeof manifest.key, 'string');
  assert.ok(manifest.key.length > 0);
});

test('manifest uses a module service worker and allows wasm', () => {
  assert.equal(manifest.background.service_worker, 'sw.js');
  assert.equal(manifest.background.type, 'module');
  assert.ok(manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
});
