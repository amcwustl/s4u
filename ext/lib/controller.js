// Controller: merges detector verdicts with user overrides into the real mute state.
// Action: {type:'fadeOut'} | {type:'fadeIn'} | {type:'spotify', cmd:'commercial'|'game'} | {type:'badge', text}
const badge = (text) => ({ type: 'badge', text });
const MUTE_ACTIONS = () => [{ type: 'fadeOut' }, { type: 'spotify', cmd: 'commercial' }, badge('Muted')];
const UNMUTE_ACTIONS = (text = 'Game') => [{ type: 'spotify', cmd: 'game' }, { type: 'fadeIn' }, badge(text)];

export class Controller {
  constructor({ shadow = false } = {}) {
    this.shadow = shadow;
    this._muted = false;     // logical mute state (in shadow mode: "would be muted")
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
    if (auto && this.shadow) return [badge('SHADOW: would mute')];
    return MUTE_ACTIONS();
  }
  _unmute(auto, text) {
    this._muted = false;
    if (auto && this.shadow) return [badge('SHADOW: would unmute')];
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
    if (this._muted) {
      if (!this._manual) this.ignoreBreak = true;
      this._manual = false;
      return this._unmute(false);
    }
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
    const actions = this._muted ? UNMUTE_ACTIONS('Off') : [badge('Off')];
    this._muted = false; this._manual = false; this.ignoreBreak = false; this.lastState = null;
    return actions;
  }
}
