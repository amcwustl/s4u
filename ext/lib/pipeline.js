// Pipeline: turns frames + 1 s PCM chunks into Samples, runs detector + controller, logs, emits actions.
// Pure: all Chrome/Web Audio work stays in offscreen.js (or the fixture player).
import { toGray, meanLuminance } from './vision.js';
import { gameSimilarity, adProbability } from './banks.js';

export const PIPELINE_DEFAULTS = {
  holdVis: 0.8,          // scoreboard this visible → sample feeds the game bank
  adBankAfterSec: 40,    // seconds into a commercial before its sound is banked as "ad"
  adBankMusic: 0.5,
  blackLum: 8,
  blackRms: 0.01,
  relearnVis: 0.2,
  relearnSec: 60,
  bootstrapSec: 45,      // until the scoreboard is learned, assume the game is on this long after arming
  rmsWindow: 1600,       // 100 ms sub-windows for detecting brief silences at cuts
  keepScores: false,     // store the feature vector on every record (fixture/tuning runs)
};

export function createPipeline({ learner, detector, controller, gameBank, adBank, classify, log, onActions, opts = {} }) {
  const o = { ...PIPELINE_DEFAULTS, ...opts };
  let frames = []; // gray frames since the last tick
  let lostSec = 0;

  function onFrame(gray) { frames.push(gray); }

  function tick(t, pcm) {
    // --- vision
    let scoreboardVis = null, logoVis = null, minLum = null;
    if (frames.length) {
      for (const g of frames) {
        if (!learner.learned) learner.push(g);
        const lum = meanLuminance(g);
        minLum = minLum === null ? lum : Math.min(minLum, lum);
      }
      if (learner.learned) {
        for (const g of frames) {
          const v = learner.visibility(g);
          scoreboardVis = Math.max(scoreboardVis ?? 0, v.scoreboard ?? 0);
          logoVis = Math.max(logoVis ?? 0, v.logo ?? 0);
        }
      }
    }
    frames = [];

    // --- audio
    let rms = null, rmsMin = null, feats = null;
    if (pcm) {
      let s = 0;
      for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
      rms = Math.sqrt(s / pcm.length);
      for (let w = 0; w + o.rmsWindow <= pcm.length; w += o.rmsWindow) {
        let ws = 0;
        for (let i = w; i < w + o.rmsWindow; i++) ws += pcm[i] * pcm[i];
        const r = Math.sqrt(ws / o.rmsWindow);
        rmsMin = rmsMin === null ? r : Math.min(rmsMin, r);
      }
      feats = classify(pcm);
    }
    // A cut to black with a momentary silence: break boundaries and ad-to-ad cuts look like this; play never does.
    const blackCut = minLum !== null && rmsMin !== null && minLum < o.blackLum && rmsMin < o.blackRms;

    // --- banks
    const bootstrapping = !learner.learned && t < o.bootstrapSec;
    const vec = feats ? (feats.embedding ?? feats.scores) : null;
    if (vec && ((scoreboardVis !== null && scoreboardVis >= o.holdVis) || bootstrapping)) gameBank.add(vec);
    if (vec && detector.state === 'COMMERCIAL' && detector.commercialSec >= o.adBankAfterSec && feats.music >= o.adBankMusic) adBank.add(vec);
    const gameSim = vec ? gameSimilarity(gameBank, vec) : null;
    const adProb = vec ? adProbability(gameBank, adBank, vec) : null;

    const sample = {
      t, scoreboardVis, logoVis, gameSim, adProb,
      speech: feats?.speech ?? 0, music: feats?.music ?? 0, blackCut,
    };
    const verdict = detector.step(sample);
    const actions = controller.update(verdict);
    if (actions.length) onActions(actions);

    // --- relearn when the learned layout is gone for a long stretch of game
    if (learner.learned && verdict.state === 'GAME' && scoreboardVis !== null && scoreboardVis < o.relearnVis) lostSec++;
    else lostSec = 0;
    if (lostSec >= o.relearnSec) { learner.reset(); lostSec = 0; log.event('relearn', { t }); }

    const record = {
      ...sample, verdict, muted: controller.muted, shadow: controller.shadow, paused: controller.paused,
      learned: learner.learned, progress: learner.progress, lum: minLum, rms, rmsMin, silence: feats?.silence ?? null,
      gameBank: gameBank.size, adBank: adBank.size,
    };
    if (o.keepScores && feats) { record.scores = Array.from(feats.scores); if (feats.embedding) record.embedding = Array.from(feats.embedding); }
    log.push(record);
    return record;
  }

  function override(kind) {
    const actions = kind === 'toggleMute' ? controller.toggleMute() : controller.togglePause();
    log.event('override', { kind });
    if (actions.length) onActions(actions);
    return actions;
  }

  function end() {
    const actions = controller.end();
    if (actions.length) onActions(actions);
    return actions;
  }

  return { onFrame, tick, override, end, toGray };
}
