import { mergeSettings } from './lib/settings.js';
import { DEFAULTS } from './lib/detector.js';
const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(null).then((stored) => {
  const s = mergeSettings(stored);
  $('shadow').checked = s.shadow; $('spotifyMode').value = s.spotifyMode; $('spotifyUri').value = s.spotifyUri;
  $('launchSpotify').checked = s.launchSpotify; $('fadeMs').value = s.fadeMs; $('keepEmbeddings').checked = s.keepEmbeddings;
  $('detector').value = Object.keys(s.detector).length ? JSON.stringify(s.detector, null, 2) : '';
});

$('save').onclick = async () => {
  let detector = {};
  const raw = $('detector').value.trim();
  if (raw) {
    try { detector = JSON.parse(raw); } catch { $('saved').textContent = 'Detector JSON is invalid'; return; }
    const bad = Object.keys(detector).filter(k => !(k in DEFAULTS));
    if (bad.length) { $('saved').textContent = `Unknown detector keys: ${bad.join(', ')}`; return; }
  }
  await chrome.storage.sync.set({
    shadow: $('shadow').checked, spotifyMode: $('spotifyMode').value, spotifyUri: $('spotifyUri').value.trim(),
    launchSpotify: $('launchSpotify').checked, fadeMs: Number($('fadeMs').value) || 300, keepEmbeddings: $('keepEmbeddings').checked, detector,
  });
  $('saved').textContent = 'Saved'; setTimeout(() => ($('saved').textContent = ''), 1500);
};
