// AudioWorklet: accumulates mono input and posts one Float32Array(16000) per second.
class Pcm1s extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16000);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const take = Math.min(ch.length - i, this.buf.length - this.n);
      this.buf.set(ch.subarray(i, i + take), this.n);
      this.n += take; i += take;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf);
        this.buf = new Float32Array(16000);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-1s', Pcm1s);
