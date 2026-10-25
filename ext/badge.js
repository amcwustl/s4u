// On-page badge: shows state inside the game player (any frame, fullscreen-aware) with override buttons.
(() => {
  if (window.__s4uBadge) return;
  window.__s4uBadge = true;

  // Only the frame that actually holds the playing video renders the badge.
  function hasVideo() { return [...document.querySelectorAll('video')].some(v => v.videoWidth > 0); }

  let host = null, root = null, hideTimer = null;
  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.id = 's4u-badge-host';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .b { pointer-events: auto; font: 12px/1.3 -apple-system, system-ui, sans-serif; color: #fff;
             background: rgba(0,0,0,.72); border-radius: 8px; padding: 6px 10px; display: flex; gap: 8px; align-items: center;
             box-shadow: 0 2px 8px rgba(0,0,0,.4); transition: opacity .3s; }
        .b.hidden { opacity: 0; pointer-events: none; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #9e9e9e; }
        .dot.game { background: #43a047; } .dot.muted { background: #e53935; } .dot.paused { background: #fb8c00; }
        .dot.shadow { background: #1e88e5; } .dot.learning { background: #fdd835; }
        button { font: inherit; background: rgba(255,255,255,.15); color: #fff; border: 0; border-radius: 5px; padding: 3px 8px; cursor: pointer; }
        button:hover { background: rgba(255,255,255,.3); }
        .sp { opacity: .7; }
      </style>
      <div class="b hidden"><span class="dot"></span><span class="txt"></span><span class="sp"></span>
        <button data-k="toggleMute">Unmute</button><button data-k="togglePause">Pause</button></div>`;
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'override', kind: b.dataset.k })));
    (document.fullscreenElement || document.body || document.documentElement).appendChild(host);
    document.addEventListener('fullscreenchange', () => (document.fullscreenElement || document.body).appendChild(host));
  }

  function stateOf(text) {
    if (text.startsWith('SHADOW')) return 'shadow';
    if (text.startsWith('Learning')) return 'learning';
    if (text === 'Muted') return 'muted';
    if (text === 'Paused') return 'paused';
    if (text === 'Game') return 'game';
    return 'off';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'badge') return;
    if (!hasVideo()) return;
    ensure();
    const box = root.querySelector('.b'), dot = root.querySelector('.dot');
    const state = stateOf(msg.text);
    dot.className = `dot ${state}`;
    root.querySelector('.txt').textContent = msg.text + (msg.shadow && state !== 'shadow' && state !== 'off' ? ' [shadow]' : '');
    root.querySelector('.sp').textContent = msg.spotify ? 'Spotify ✓' : 'Spotify ✗';
    root.querySelector('[data-k=toggleMute]').textContent = state === 'muted' ? 'Unmute' : 'Mute';
    root.querySelector('[data-k=togglePause]').textContent = state === 'paused' ? 'Resume' : 'Pause';
    clearTimeout(hideTimer);
    if (state === 'off') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (state === 'game') hideTimer = setTimeout(() => box.classList.add('hidden'), 4000);
  });
})();
