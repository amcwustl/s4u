// Audio embedding banks: what this broadcast's game sounds like, and what its ads sound like.
// Similarity is a z-score: how far a vector's cosine-to-centroid falls below the bank's own mean,
// in units of the bank's standard deviation. YAMNet embeddings are all-positive, so raw cosines
// crowd near 1 and only the bank's own spread gives a usable scale.
export const MIN_GAME_SAMPLES = 20;
export const MIN_AD_SAMPLES = 20;
export const AD_Z_MARGIN = 2;   // vector sits 2 sd further outside the game cluster than the ad cluster → compare 1
export const Z_SCALE = 4;   // z of 4 sd below the bank mean → adProb 1 (z 3 → 0.75, z 2 → 0.5)
const MIN_SD = 1e-3;

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
    this._stats = null;
  }
  get size() { return this.items.length; }
  add(v) {
    this.items.push(Float32Array.from(v));
    if (this.items.length > this.maxSize) this.items.shift();
    this._stats = null;
  }
  centroid() {
    if (!this.items.length) return null;
    const c = new Float32Array(this.items[0].length);
    for (const v of this.items) for (let i = 0; i < c.length; i++) c[i] += v[i];
    for (let i = 0; i < c.length; i++) c[i] /= this.items.length;
    return c;
  }
  /** Centroid plus mean/sd of members' cosine to it (cached until the next add). */
  stats() {
    if (this._stats) return this._stats;
    const c = this.centroid();
    if (!c) return null;
    const cs = this.items.map(m => cosine(m, c));
    const mu = cs.reduce((a, b) => a + b, 0) / cs.length;
    const sd = Math.max(MIN_SD, Math.sqrt(cs.reduce((a, b) => a + (b - mu) ** 2, 0) / cs.length));
    return (this._stats = { centroid: c, mu, sd });
  }
  /** How many sd below the bank mean this vector's cosine-to-centroid is (negative = inside the cluster). */
  z(v) {
    const st = this.stats();
    return st ? (st.mu - cosine(v, st.centroid)) / st.sd : 0;
  }
  nearest(v) {
    let best = -1;
    for (const m of this.items) best = Math.max(best, cosine(m, v));
    return best;
  }
}

export function gameSimilarity(game, v) {
  if (game.size < MIN_GAME_SAMPLES) return null;
  return clamp01(1 - game.z(v) / Z_SCALE);
}

// Raw nearest-cosine comparison sat at ≈ 0.5 for everything (all-positive embeddings) and, averaged in,
// pulled adProb toward 0.5 once the ad bank existed. The ad bank now only ever raises adProb, and only
// through the same z-score scale the game bank uses.
export function adProbability(game, ad, v) {
  const sim = gameSimilarity(game, v);
  if (sim === null) return null;
  const fromSim = clamp01(1 - sim);
  if (ad.size < MIN_AD_SAMPLES) return fromSim;
  const compare = clamp01((game.z(v) - ad.z(v)) / AD_Z_MARGIN);
  return Math.max(fromSim, compare);
}
