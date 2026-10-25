#!/usr/bin/env node
// CLI: node tools/replay.mjs <log.json> [--set goneSec=5 --set adProb=0.8]
import { readFileSync } from 'node:fs';
import { replay, parseOverrides } from '../ext/lib/replay.js';
export { replay, parseOverrides };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { file, overrides } = parseOverrides(process.argv.slice(2));
  if (!file) { console.error('usage: node tools/replay.mjs <log.json> [--set key=value]...'); process.exit(2); }
  const r = replay(JSON.parse(readFileSync(file, 'utf8')), overrides);
  for (const t of r.transitions) console.log(`${String(t.t).padStart(6)}  ${t.state.padEnd(10)} ${t.reason}`);
  if (r.labeled) console.log(`ad heard: ${r.adHeardSec} s\ngame muted: ${r.gameMutedSec} s`);
  else console.log('(no labels in log; mark AD/GAME in the debug panel to score)');
}
