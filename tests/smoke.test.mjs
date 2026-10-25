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

test('manifest key is an RSA public key (SubjectPublicKeyInfo), never a private key', () => {
  // DER SubjectPublicKeyInfo for RSA-2048 begins with this base64 prefix; PKCS8 private keys begin with "MIIEv".
  assert.ok(manifest.key.startsWith('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A'), 'key is not a public key');
});

test('manifest injects the badge content script into all frames and declares options', () => {
  const cs = manifest.content_scripts[0];
  assert.deepEqual(cs.matches, ['<all_urls>']);
  assert.equal(cs.all_frames, true);
  assert.ok(cs.js.includes('badge.js'));
  assert.ok(cs.css.includes('badge.css'));
  assert.equal(manifest.options_ui.page, 'options.html');
});
