// Re-runs the detector over an exported log with optional threshold overrides and scores it against labels.
import { Detector } from './detector.js';

/** Label events → [{t, label}], using data.t or the event timestamp relative to the log start. */
function labelsOf(log) {
  const start = Date.parse(log.started);
  return (log.events ?? [])
    .filter(e => e.name === 'label')
    .map(e => ({ t: e.data?.t ?? Math.round((Date.parse(e.at) - start) / 1000), label: e.data.label }))
    .sort((a, b) => a.t - b.t);
}

export function replay(log, overrides = {}) {
  const d = new Detector(overrides);
  const labels = labelsOf(log);
  const transitions = [];
  let adHeardSec = 0, gameMutedSec = 0, prev = 'GAME', li = -1, label = null;
  for (const s of log.samples) {
    while (li + 1 < labels.length && labels[li + 1].t <= s.t) { li++; label = labels[li].label; }
    const v = d.step(s);
    if (v.state !== prev) { transitions.push({ t: s.t, state: v.state, reason: v.reason }); prev = v.state; }
    if (label === 'ad' && v.state === 'GAME') adHeardSec++;
    if (label === 'game' && v.state === 'COMMERCIAL') gameMutedSec++;
  }
  return { transitions, adHeardSec, gameMutedSec, labeled: labels.length > 0 };
}

export function parseOverrides(argv) {
  const overrides = {};
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--set') { const [k, v] = argv[++i].split('='); overrides[k] = Number(v); }
    else file = argv[i];
  }
  return { file, overrides };
}
