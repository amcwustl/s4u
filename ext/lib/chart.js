// Tiny canvas chart for per-second records: signal lines 0..1 plus state and mute bands. No dependencies.
const SERIES = [
  ['scoreboardVis', '#43a047'], ['logoVis', '#9ccc65'], ['gameSim', '#1e88e5'], ['adProb', '#e53935'],
];
export function drawChart(canvas, records, { windowSec = 600 } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, bandH = 14, plotH = H - 2 * bandH - 4;
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
  const recs = records.slice(-windowSec);
  if (!recs.length) return;
  const t0 = recs[0].t, span = Math.max(windowSec, recs.at(-1).t - t0 + 1);
  const x = (t) => ((t - t0) / span) * W;
  // bands
  for (const r of recs) {
    const xs = x(r.t), w = Math.max(1, W / span);
    ctx.fillStyle = r.verdict?.state === 'COMMERCIAL' ? '#e53935' : '#2e7d32';
    ctx.fillRect(xs, plotH + 2, w, bandH);
    ctx.fillStyle = r.muted ? (r.shadow ? '#1e88e5' : '#fdd835') : '#333';
    ctx.fillRect(xs, plotH + bandH + 4, w, bandH);
  }
  // gridlines
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  for (const y of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(0, plotH * (1 - y)); ctx.lineTo(W, plotH * (1 - y)); ctx.stroke(); }
  // series
  for (const [key, color] of SERIES) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); let pen = false;
    for (const r of recs) {
      const v = r[key];
      if (v === null || v === undefined) { pen = false; continue; }
      const px = x(r.t), py = plotH * (1 - Math.min(1, Math.max(0, v)));
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke();
  }
  // black cuts
  ctx.fillStyle = '#fff';
  for (const r of recs) if (r.blackCut) ctx.fillRect(x(r.t), 0, 2, plotH);
}
export const LEGEND = SERIES;
