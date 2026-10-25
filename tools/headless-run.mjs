#!/usr/bin/env node
// Opens a URL in a separate headless Chrome, waits for document.title to become "<prefix> DONE"/"ERROR",
// then prints window.__result (or the error). Usage: node tools/headless-run.mjs <url> [titlePrefix=FIXTURE] [timeoutSec=600] [--save path]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const saveIdx = args.indexOf('--save');
const savePath = saveIdx >= 0 ? args.splice(saveIdx, 2)[1] : null;
const [url, prefix = 'FIXTURE', timeoutSec = '600'] = args;
const port = 9333 + Math.floor(Math.random() * 100);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--user-data-dir=/tmp/s4u-headless-${port}`, `--remote-debugging-port=${port}`,
  '--autoplay-policy=no-user-gesture-required', url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find(p => p.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  if (!ws) throw new Error('could not connect to headless Chrome');
  await new Promise((res) => (ws.onopen = res));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); } };
}
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.value; }

try {
  await connect();
  const deadline = Date.now() + Number(timeoutSec) * 1000;
  let title = '';
  while (Date.now() < deadline) {
    title = await evalJs('document.title');
    if (title === `${prefix} DONE` || title === `${prefix} ERROR`) break;
    await sleep(1000);
  }
  if (title === `${prefix} DONE`) {
    const result = await evalJs('JSON.stringify(window.__result)');
    console.log(result);
    if (savePath) { writeFileSync(savePath, await evalJs('JSON.stringify(window.__lastLog ?? null)')); }
  } else {
    console.error('FAILED:', title, await evalJs('window.__error || document.getElementById("out")?.textContent'));
    process.exitCode = 1;
  }
} finally { chrome.kill(); }
