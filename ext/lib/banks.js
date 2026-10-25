// Audio embedding banks: what this broadcast's game sounds like, and what its ads sound like.
export const MIN_GAME_SAMPLES = 20;

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export class Bank {
  constructor(maxSize = 600) {
    this.maxSize = maxSize;
    this.items = [];
  }
  get size() { return this.items.length; }
  add(v) {
    this.items.push(Float32Array.from(v));
    if (this.items.length > this.maxSize) this.items.shift();
  }
  centroid() {
    if (!this.items.length) return null;
    const c = new Float32Array(this.items[0].length);
    for (const v of this.items) for (let i = 0; i < c.length; i++) c[i] += v[i];
    for (let i = 0; i < c.length; i++) c[i] /= this.items.length;
    return c;
  }
  nearest(v) {
    let best = -1;
    for (const m of this.items) best = Math.max(best, cosine(m, v));
    return best;
  }
}

export function gameSimilarity(game, v) {
  if (game.size < MIN_GAME_SAMPLES) return null;
  return clamp01(cosine(game.centroid(), v));
}

export function adProbability(game, ad, v) {
  const sim = gameSimilarity(game, v);
  if (sim === null) return null;
  const fromSim = 1 - sim;
  if (ad.size === 0) return clamp01(fromSim);
  const compare = (ad.nearest(v) - game.nearest(v) + 1) / 2;
  return clamp01((compare + fromSim) / 2);
}
