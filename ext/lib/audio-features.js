// YAMNet audio features via MediaPipe tasks-audio. Input: 1 s of 16 kHz mono PCM.
// Output: 1024-d YAMNet embedding (the similarity vector), all 521 class scores, and speech/music/silence shortcuts.
import { AudioClassifier, AudioEmbedder, FilesetResolver } from '../vendor/mediapipe/audio_bundle.mjs';

export const NUM_CLASSES = 521;
export const EMBEDDING_DIM = 1024;
export const SAMPLE_RATE = 16000;

/**
 * @param {string} baseUrl URL of the extension root (or the ext/ dir over http), no trailing slash.
 */
export async function createAudioFeatures(baseUrl) {
  const fileset = await FilesetResolver.forAudioTasks(`${baseUrl}/vendor/mediapipe/wasm`);
  const [classifier, embedder] = await Promise.all([
    AudioClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${baseUrl}/model/yamnet.tflite` }, maxResults: -1, scoreThreshold: 0,
    }),
    AudioEmbedder.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${baseUrl}/model/yamnet_embedding.tflite` }, l2Normalize: true,
    }),
  ]);
  let idx = null; // category index by name, filled on first result

  function classify(pcm16k) {
    const results = classifier.classify(pcm16k, SAMPLE_RATE);
    const scores = new Float32Array(NUM_CLASSES);
    let n = 0;
    for (const r of results) {
      const cats = r.classifications?.[0]?.categories ?? [];
      if (!cats.length) continue;
      if (!idx) { idx = {}; for (const c of cats) idx[c.categoryName] = c.index; }
      for (const c of cats) scores[c.index] += c.score;
      n++;
    }
    if (n > 1) for (let i = 0; i < scores.length; i++) scores[i] /= n;

    // Embedding: YAMNet yields one 1024-d vector per ~1 s window; average any extra windows.
    const embedding = new Float32Array(EMBEDDING_DIM);
    let m = 0;
    for (const r of embedder.embed(pcm16k, SAMPLE_RATE)) {
      const e = r.embeddings?.[0]?.floatEmbedding;
      if (!e) continue;
      for (let i = 0; i < EMBEDDING_DIM; i++) embedding[i] += e[i];
      m++;
    }
    if (m > 1) for (let i = 0; i < EMBEDDING_DIM; i++) embedding[i] /= m;

    const get = (name) => (idx && idx[name] !== undefined ? scores[idx[name]] : 0);
    return { scores, embedding: m ? embedding : null, speech: get('Speech'), music: get('Music'), silence: get('Silence') };
  }

  /** Top-k category names for debugging. */
  function top(scores, k = 3) {
    if (!idx) return [];
    return Object.keys(idx).map(n => [n, scores[idx[n]]]).sort((a, b) => b[1] - a[1]).slice(0, k);
  }

  return { classify, top, close: () => { classifier.close(); embedder.close(); } };
}
