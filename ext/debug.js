import { drawChart, LEGEND } from './lib/chart.js';
import { mergeSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const records = [];
const port = chrome.runtime.connect({ name: 'debug' });
let lastComponents = [];

$('legend').innerHTML = LEGEND.map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('');

port.onMessage.addListener((msg) => {
  if (msg.type === 'sample') {
    records.push(msg.record);
    if (records.length > 14400) records.shift();
    lastComponents = msg.components ?? [];
    render(msg);
  } else if (msg.type === 'log' && msg.log) {
    const blob = new Blob([JSON.stringify(msg.log)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `s4u-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click();
  } else if (msg.type === 'thumbnail' && msg.dataUrl) {
    $('img').src = msg.dataUrl;
    for (const el of document.querySelectorAll('.thumb .c')) el.remove();
    for (const c of lastComponents) {
      const d = document.createElement('div');
      d.className = `c ${c.kind}`;
      d.style.left = `${c.x}px`; d.style.top = `${c.y}px`; d.style.width = `${c.w}px`; d.style.height = `${c.h}px`;
      $('thumb').appendChild(d);
    }
  }
});

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? v.toFixed(2) : String(v));
function render({ record: r, hasAudio, hasVideo, blackVideo }) {
  drawChart($('chart'), records);
  const rows = [
    ['t', r.t], ['scoreboardVis', r.scoreboardVis], ['logoVis', r.logoVis], ['gameSim', r.gameSim], ['adProb', r.adProb],
    ['speech', r.speech], ['music', r.music], ['silence', r.silence], ['lum', r.lum], ['rms', r.rms],
    ['goneSec', r.verdict?.goneSec], ['gameBank', r.gameBank], ['adBank', r.adBank],
    ['learned', `${r.learned} (${Math.round((r.progress ?? 0) * 100)}%)`], ['audio/video', `${hasAudio ? 'yes' : 'NO'} / ${hasVideo ? (blackVideo ? 'BLACK' : 'yes') : 'NO'}`],
  ];
  $('vals').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join('');
  $('state').innerHTML = `${r.verdict?.state} (${r.verdict?.reason}) ${r.muted ? `<span class="${r.shadow ? 'shadow' : 'muted'}">${r.shadow ? 'would be muted' : 'MUTED'}</span>` : ''} ${r.paused ? '⏸ paused' : ''}`;
}

setInterval(() => port.postMessage({ type: 'thumbnail' }), 2000);
$('export').onclick = () => port.postMessage({ type: 'exportLog' });
$('mute').onclick = () => port.postMessage({ type: 'override', kind: 'toggleMute' });
$('pause').onclick = () => port.postMessage({ type: 'override', kind: 'togglePause' });
$('labelAd').onclick = () => port.postMessage({ type: 'label', label: 'ad' });
$('labelGame').onclick = () => port.postMessage({ type: 'label', label: 'game' });
document.addEventListener('keydown', (e) => {
  if (e.key === 'a' || e.key === 'A') $('labelAd').click();
  if (e.key === 'g' || e.key === 'G') $('labelGame').click();
});
chrome.storage.sync.get(null).then((s) => { $('shadow').checked = mergeSettings(s).shadow; });
$('shadow').onchange = () => chrome.storage.sync.set({ shadow: $('shadow').checked });
