// Detector: GAME / COMMERCIAL state machine over 1 Hz samples.
// Sample: { t, scoreboardVis, logoVis, gameSim, adProb, speech, music, blackCut }
//   scoreboardVis/logoVis null → no vision (not learned yet, or no video)
//   gameSim/adProb null        → no audio profile yet (cold start, or no audio)
// Verdict: { state, reason, goneSec }
export const DEFAULTS = {
  goneSec: 3, adProb: 0.75, adProbSec: 2,
  adVoteProb: 0.5, adVoteWindow: 10, adVoteHits: 6, adVoteGoneSec: 10,
  holdVis: 0.8, dipVis: 0.4, dipHoldSec: 3, ambientWindowSec: 30, ambientMax: 0.2,
  recoverVisFast: 0.85, recoverVisSlow: 0.4, recoverSlowFrames: 3,
  recoverSim: 0.70, recoverSimHits: 5, recoverSimWindow: 6,
  coldGoneSec: 40, audioOnlyAdSec: 15, audioOnlyVoteWindow: 15, audioOnlyVoteHits: 10, maxCommercialSec: 240,
};

export class Detector {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this._state = 'GAME';
    this.reason = 'init';
    this.goneSec = 0;
    this.adStreak = 0;
    this.adVotes = [];
    this.audioOnlyStreak = 0;
    this.audioOnlyVotes = [];
    this.dipStreak = 0;
    this.recoverStreak = 0;
    this.simWindow = [];
    this.commercialSec = 0;
    this.lastCut = false;
  }

  get state() { return this._state; }

  _enter(state, reason) {
    this._state = state; this.reason = reason;
    this.adStreak = 0; this.adVotes = []; this.audioOnlyStreak = 0; this.audioOnlyVotes = []; this.dipStreak = 0; this.recoverStreak = 0;
    this.simWindow = []; this.commercialSec = 0; this.lastCut = false;
    if (state === 'GAME') this.goneSec = 0;
  }

  step(s) {
    const o = this.o;
    const vis = s.scoreboardVis, logo = s.logoVis;
    const hasVision = vis !== null && vis !== undefined;
    // Crowd, whistles, a quiet ad: neither game nor ad evidence.
    const ambient = (s.speech ?? 1) < o.ambientMax && (s.music ?? 1) < o.ambientMax;

    if (this._state === 'GAME') {
      // --- hold rules keep the gone timer at zero
      const anyGraphic = Math.max(hasVision ? vis : -1, logo ?? -1);
      if (hasVision && vis >= o.dipVis) this.dipStreak++; else this.dipStreak = 0;
      if (anyGraphic >= o.holdVis || this.dipStreak >= o.dipHoldSec) {
        this.goneSec = 0; this.adStreak = 0; this.adVotes = [];
        if (this.dipStreak >= o.dipHoldSec) this.dipStreak = 0;
      } else if (hasVision) {
        this.goneSec++;
      }

      const hasAd = s.adProb !== null && s.adProb !== undefined;
      const adLike = hasAd && s.adProb >= o.adProb;

      if (!hasVision) {
        // audio-only mode (no video / scoreboard never learned)
        this.audioOnlyStreak = adLike ? this.audioOnlyStreak + 1 : 0;
        if (this.audioOnlyStreak >= o.audioOnlyAdSec) { this._enter('COMMERCIAL', 'audio-only'); return this._verdict(); }
        if (hasAd) {
          this.audioOnlyVotes.push(s.adProb >= o.adVoteProb ? 1 : 0);
          if (this.audioOnlyVotes.length > o.audioOnlyVoteWindow) this.audioOnlyVotes.shift();
          const hits = this.audioOnlyVotes.reduce((a, b) => a + b, 0);
          if (hits >= o.audioOnlyVoteHits) { this._enter('COMMERCIAL', 'audio-only-vote'); return this._verdict(); }
        }
        return this._verdict();
      }

      // Play never cuts to black with silence, so any black cut once the scoreboard is gone is a break,
      // however long it has been gone. A cut mid-second is masked by that second's other frame still
      // showing the scoreboard (vis is the max over frames), so it is carried to the next second.
      const cut = s.blackCut || this.lastCut;
      this.lastCut = !!s.blackCut;
      if (cut && this.goneSec > 0) {
        this._enter('COMMERCIAL', 'black-cut'); return this._verdict();
      }
      if (s.adProb === null || s.adProb === undefined) {
        if (this.goneSec >= o.coldGoneSec) { this._enter('COMMERCIAL', 'cold-start'); return this._verdict(); }
        return this._verdict();
      }
      if (this.goneSec > o.goneSec) {
        if (ambient && this.goneSec <= o.ambientWindowSec) { /* crowd/whistles: neither game nor ad */ }
        else {
          if (adLike) this.adStreak++; else this.adStreak = 0;
          // The softer vote path only opens once the scoreboard has been gone a while: short
          // produced packages with music must never mute (anti-goal #1).
          if (this.goneSec >= o.adVoteGoneSec) {
            this.adVotes.push(s.adProb >= o.adVoteProb ? 1 : 0);
            if (this.adVotes.length > o.adVoteWindow) this.adVotes.shift();
          }
        }
        if (this.adStreak >= o.adProbSec) { this._enter('COMMERCIAL', 'audio'); return this._verdict(); }
        const hits = this.adVotes.reduce((a, b) => a + b, 0);
        if (hits >= o.adVoteHits) { this._enter('COMMERCIAL', 'audio-vote'); return this._verdict(); }
      }
      return this._verdict();
    }

    // --- COMMERCIAL
    this.commercialSec++;
    if (hasVision) this.goneSec++;
    if (hasVision && vis >= o.recoverVisFast) { this._enter('GAME', 'scoreboard'); return this._verdict(); }
    if (hasVision && vis >= o.recoverVisSlow) this.recoverStreak++; else this.recoverStreak = 0;
    if (this.recoverStreak >= o.recoverSlowFrames) { this._enter('GAME', 'scoreboard'); return this._verdict(); }
    // Near-silent ad seconds score as "game-like" against the bank; only speech or music can vouch for the game.
    if (s.gameSim !== null && s.gameSim !== undefined && !ambient) {
      this.simWindow.push(s.gameSim >= o.recoverSim ? 1 : 0);
      if (this.simWindow.length > o.recoverSimWindow) this.simWindow.shift();
      const hits = this.simWindow.reduce((a, b) => a + b, 0);
      if (hits >= o.recoverSimHits) { this._enter('GAME', 'audio'); return this._verdict(); }
    }
    if (this.commercialSec >= o.maxCommercialSec) { this._enter('GAME', 'max-commercial'); return this._verdict(); }
    return this._verdict();
  }

  _verdict() { return { state: this._state, reason: this.reason, goneSec: this.goneSec }; }
}
