// Controller: merges detector verdicts with user overrides into the real mute state.
// Action: {type:'fadeOut'} | {type:'fadeIn'} | {type:'spotify', cmd:'commercial'|'game'} | {type:'badge', text}
const badge = (text) => ({ type: 'badge', text });
const MUTE_ACTIONS = () => [{ type: 'fadeOut' }, { type: 'spotify', cmd: 'commercial' }, badge('Muted')];
const UNMUTE_ACTIONS = (text = 'Game') => [{ type: 'spotify', cmd: 'game' }, { type: 'fadeIn' }, badge(text)];

export class Controller {
  constructor({ shadow = false } = {}) {
    this.shadow = shadow;
    this._muted = false;     // logical mute state (in shadow mode: "would be muted")
    this._real = false;      // whether the current mute actually faded the tab / started Spotify
    this._manual = false;
    this._paused = false;
    this.ignoreBreak = false;
    this.lastState = null;
  }
  get muted() { return this._muted; }
  get paused() { return this._paused; }
  get manual() { return this._manual; }

  _mute(auto) {
    this._muted = true;
    if (auto && this.shadow) { this._real = false; return [badge('SHADOW: would mute')]; }
    this._real = true;
    return MUTE_ACTIONS();
  }
  _unmute(auto, text) {
    const wasReal = this._real;
    this._muted = false; this._real = false;
    if (!wasReal) return [badge(auto ? 'SHADOW: would unmute' : text ?? 'Game')];
    return UNMUTE_ACTIONS(text);
  }

  update(verdict) {
    const prev = this.lastState;
    const changed = verdict.state !== prev;
    this.lastState = verdict.state;

    if (this._paused) return changed ? [badge('Paused')] : [];

    if (verdict.state === 'COMMERCIAL') {
      if (this._muted || this.ignoreBreak) return [];
      return this._mute(true);
    }
    // GAME
    if (prev === 'COMMERCIAL') { this.ignoreBreak = false; this._manual = false; }
    if (this._muted && !this._manual) return this._unmute(true);
    return [];
  }

  toggleMute() {
    if (this._muted && this._real) {
      if (!this._manual) this.ignoreBreak = true;
      this._manual = false;
      return this._unmute(false);
    }
    // not muted, or only "would be muted" in shadow: the user wants a real mute now
    this._manual = true;
    return this._mute(false);
  }

  togglePause() {
    this._paused = !this._paused;
    if (this._paused) {
      if (this._muted && !this._manual) return this._unmute(false, 'Paused');
      return [badge('Paused')];
    }
    this.lastState = null; // next verdict counts as a change
    return [badge('Game')];
  }

  end() {
    const actions = this._muted && this._real ? UNMUTE_ACTIONS('Off') : [badge('Off')];
    this._muted = false; this._real = false; this._manual = false; this.ignoreBreak = false; this.lastState = null;
    return actions;
  }
}
