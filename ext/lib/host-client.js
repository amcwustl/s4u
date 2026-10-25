// Native-messaging client with request/reply correlation, timeouts and reconnect backoff.
// Pure: `connect()` returns a chrome.runtime.Port-like object; `timers` injects setTimeout/clearTimeout.
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
export const REPLY_TIMEOUT_MS = 2000;

export function createHostClient({ connect, timers = globalThis, onState = () => {} }) {
  const state = { connected: false, lastReply: null };
  let port = null, running = false, attempt = 0, reconnectTimer = null;
  const queue = []; // pending {resolve, reject, timer}, replies arrive in order

  function setConnected(v) { if (state.connected !== v) { state.connected = v; onState(state); } }

  function failAll(reason) {
    while (queue.length) { const q = queue.shift(); timers.clearTimeout(q.timer); q.reject(new Error(reason)); }
  }

  function open() {
    port = connect();
    port.onMessage.addListener((msg) => {
      attempt = 0;
      state.lastReply = msg;
      setConnected(true);
      const q = queue.shift();
      if (q) { timers.clearTimeout(q.timer); q.resolve(msg); }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setConnected(false);
      failAll('disconnected');
      if (!running) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt++;
      reconnectTimer = timers.setTimeout(() => { reconnectTimer = null; open(); }, delay);
    });
  }

  return {
    state,
    start() { if (running) return; running = true; attempt = 0; open(); },
    stop() {
      running = false;
      if (reconnectTimer) { timers.clearTimeout(reconnectTimer); reconnectTimer = null; }
      failAll('stopped');
      if (port) { const p = port; port = null; p.disconnect(); }
      setConnected(false);
    },
    send(msg) {
      return new Promise((resolve, reject) => {
        if (!port) return reject(new Error('not connected'));
        const entry = { resolve, reject, timer: null };
        entry.timer = timers.setTimeout(() => {
          const i = queue.indexOf(entry);
          if (i >= 0) queue.splice(i, 1);
          reject(new Error('timeout'));
        }, REPLY_TIMEOUT_MS);
        queue.push(entry);
        port.postMessage(msg);
      });
    },
  };
}
