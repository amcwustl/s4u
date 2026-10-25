// YAMNet audio features via MediaPipe tasks-audio. Input: 1 s of 16 kHz mono PCM.
// Output: all 521 class scores (used as the embedding) plus speech/music/silence shortcuts.
import { AudioClassifier, FilesetResolver } from '../vendor/mediapipe/audio_bundle.mjs';

export const NUM_CLASSES = 521;
export const SAMPLE_RATE = 16000;

/**
 * @param {string} baseUrl URL of the extension root (or the ext/ dir over http), no trailing slash.
 */
export async function createAudioFeatures(baseUrl) {
  const fileset = await FilesetResolver.forAudioTasks(`${baseUrl}/vendor/mediapipe/wasm`);
  const classifier = await AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${baseUrl}/model/yamnet.tflite` },
    maxResults: -1,
    scoreThreshold: 0,
  });
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
    const get = (name) => (idx && idx[name] !== undefined ? scores[idx[name]] : 0);
    return { scores, speech: get('Speech'), music: get('Music'), silence: get('Silence') };
  }

  /** Top-k category names for debugging. */
  function top(scores, k = 3) {
    if (!idx) return [];
    const names = Object.keys(idx);
    return names.map(n => [n, scores[idx[n]]]).sort((a, b) => b[1] - a[1]).slice(0, k);
  }

  return { classify, top, close: () => classifier.close() };
}
