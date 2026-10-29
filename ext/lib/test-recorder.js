// TEST-ONLY — scrap once tuning is done (with the "🧪 TEST" menu item, the downloads permission and every
// line marked TEST-ONLY in sw.js / offscreen.js / badge.js).
// Records the captured tab (video + audio, exactly what the detector sees) next to the detection log and
// saves both into Downloads/<folder>/: a first part after a minute (proof that saving works), then one
// every partSec, then the rest on stop. Nothing is lost when recording stops, however it stops.
// Parts are consecutive slices of one WebM; only part-001 has the header: `cat part-*.webm > game.webm`.
export const TEST_RECORDER_DEFAULTS = {
  mimeType: 'video/webm;codecs=vp8,opus',
  videoBitsPerSecond: 1_000_000,
  firstPartSec: 60,
  partSec: 900,
};

/**
 * @param {object} o
 * @param {MediaStream} o.stream       tracks to record; stopped when recording stops
 * @param {(blob: Blob, filename: string) => Promise<unknown>} o.save
 * @param {() => object} o.getLog      current log JSON, saved as log.json with every part
 * @param {string} o.folder            subfolder of Downloads
 */
export function createTestRecorder({ stream, save, getLog, folder, Recorder = MediaRecorder, timers = globalThis, opts = {} }) {
  const o = { ...TEST_RECORDER_DEFAULTS, ...opts };
  let chunks = [], parts = 0, queue = Promise.resolve(), timer = null, stopping = null;
  const rec = new Recorder(stream, { mimeType: o.mimeType, videoBitsPerSecond: o.videoBitsPerSecond });
  const ended = new Promise((res) => { rec.onstop = res; });
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.start(1000);

  async function saveNow() {
    const take = chunks; chunks = [];
    const saves = [];
    if (take.length) saves.push(save(new Blob(take, { type: 'video/webm' }), `${folder}/part-${String(++parts).padStart(3, '0')}.webm`));
    saves.push(save(new Blob([JSON.stringify(getLog())], { type: 'application/json' }), `${folder}/log.json`));
    await Promise.all(saves);
  }
  const flush = () => (queue = queue.then(saveNow, saveNow));

  timer = timers.setTimeout(function tick() { flush(); timer = timers.setTimeout(tick, o.partSec * 1000); }, o.firstPartSec * 1000);

  /** Stops recording and resolves once every part and the final log are saved. Safe to call twice. */
  function stop() {
    if (stopping) return stopping;
    timers.clearTimeout(timer);
    if (rec.state !== 'inactive') rec.stop(); // fires the last dataavailable, then stop
    stopping = ended.then(flush).then(() => {
      for (const t of stream.getTracks()) t.stop();
      return { folder, parts };
    });
    return stopping;
  }

  return { stop, flush, get parts() { return parts; } };
}

/** Downloads subfolder for a test session started at `date`, e.g. s4u-test-2026-10-29T23-50-01. */
export function testFolderName(date = new Date()) {
  return `s4u-test-${date.toISOString().slice(0, 19).replace(/:/g, '-')}`;
}
