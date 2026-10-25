// Scoreboard learner: finds on-screen graphics that stay fixed and sharp while the video changes,
// then scores how visible each learned graphic is in later frames. Works on 8-bit gray frames.
export const FRAME_W = 320, FRAME_H = 180;

export function toGray(rgba, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2] + 0.5) | 0;
  }
  return out;
}

export function meanLuminance(gray) {
  if (!gray.length) return 0;
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return s / gray.length;
}

/** Sobel gradient magnitude (approx |gx|+|gy|) for every interior pixel; borders are 0. */
function sobel(g, w, h, out) {
  out.fill(0);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] + g[i - w + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + w - 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      out[i] = (Math.abs(gx) + Math.abs(gy)) / 4;
    }
  }
}

export class ScoreboardLearner {
  constructor({ w = FRAME_W, h = FRAME_H, learnFrames = 60, stableFrac = 0.7, diffT = 12, gradT = 20, minArea = 40, frozenT = 1.0, matchT = 24 } = {}) {
    Object.assign(this, { w, h, learnFrames, stableFrac, diffT, gradT, minArea, frozenT, matchT });
    this.reset();
  }

  reset() {
    this.prev = null;
    this.count = new Uint16Array(this.w * this.h);
    this.grad = new Float32Array(this.w * this.h);
    this.accepted = 0;
    this.template = null;
    this.comps = [];
    this._learned = false;
  }

  get learned() { return this._learned; }
  get progress() { return Math.min(1, this.accepted / this.learnFrames); }

  push(gray) {
    if (this._learned) return;
    if (!this.prev) { this.prev = Uint8Array.from(gray); return; }
    // Frozen / buffering frame: nothing moved, nothing to learn from.
    let diffSum = 0;
    for (let i = 0; i < gray.length; i++) diffSum += Math.abs(gray[i] - this.prev[i]);
    if (diffSum / gray.length < this.frozenT) return;

    sobel(gray, this.w, this.h, this.grad);
    for (let i = 0; i < gray.length; i++) {
      if (Math.abs(gray[i] - this.prev[i]) < this.diffT && this.grad[i] > this.gradT) this.count[i]++;
    }
    this.prev.set(gray);
    this.accepted++;
    if (this.accepted >= this.learnFrames) this._finish(gray);
  }

  _finish(gray) {
    const { w, h } = this;
    const need = this.stableFrac * this.accepted;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) if (this.count[i] >= need) mask[i] = 1;
    this.template = Uint8Array.from(gray);
    this.comps = this._components(mask).filter(c => c.area >= this.minArea);
    this.comps.sort((a, b) => b.area - a.area);
    this.comps.forEach((c, i) => { c.kind = i === 0 ? 'scoreboard' : 'logo'; });
    this._learned = true;
  }

  /** 4-connected components over a binary mask. Returns {x,y,w,h,area,pixels}. */
  _components(mask) {
    const { w, h } = this;
    const seen = new Uint8Array(w * h);
    const comps = [];
    const stack = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      const pixels = [];
      let minX = w, minY = h, maxX = -1, maxY = -1;
      stack.push(start); seen[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        pixels.push(i);
        const x = i % w, y = (i / w) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        const nbrs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const n of nbrs) if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
      comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area: pixels.length, pixels: Int32Array.from(pixels) });
    }
    return comps;
  }

  components() {
    return this.comps.map(({ x, y, w, h, area, kind }) => ({ x, y, w, h, area, kind }));
  }

  visibility(gray) {
    if (!this._learned) return { scoreboard: null, logo: null, perComponent: [] };
    const perComponent = this.comps.map(c => {
      let hit = 0;
      for (let k = 0; k < c.pixels.length; k++) {
        const i = c.pixels[k];
        if (Math.abs(gray[i] - this.template[i]) < this.matchT) hit++;
      }
      return hit / c.pixels.length;
    });
    const scoreboard = perComponent.length ? perComponent[0] : null;
    const logo = perComponent.length > 1 ? Math.max(...perComponent.slice(1)) : null;
    return { scoreboard, logo, perComponent };
  }
}
