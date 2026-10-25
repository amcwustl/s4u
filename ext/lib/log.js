// Ring buffer of per-second records plus timestamped events; exported as JSON for offline tuning.
export class SampleLog {
  constructor(max = 14400) {
    this.max = max;
    this.samples = [];
    this.events = [];
    this.started = new Date().toISOString();
  }
  push(record) {
    this.samples.push(record);
    if (this.samples.length > this.max) this.samples.shift();
  }
  event(name, data = {}) {
    this.events.push({ name, data, at: new Date().toISOString() });
  }
  toJSON() {
    return { version: 1, started: this.started, samples: this.samples, events: this.events };
  }
}
