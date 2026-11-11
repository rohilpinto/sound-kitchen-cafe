// Short mechanical noises for the control surface. They are mixed by the caller
// straight to the speakers, not through the soundscape bus.

export class Sfx {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.muted = false;
    this.lastDetent = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.time = new Float32Array(this.analyser.fftSize);
    this.out.connect(this.analyser);
    this.analyser.connect(destination);
    this.held = 0;
    this.clicks = 0;
    const watch = () => {
      this.held = Math.max(this.level(), this.held * 0.82);
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);

    const length = Math.floor(ctx.sampleRate * 0.4);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  setMuted(muted) {
    this.muted = muted;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    if (muted) {
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0, now + 0.08);
    } else {
      this.out.gain.setValueAtTime(1, now);
    }
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i += 1) sum += this.time[i] * this.time[i];
    return Math.sqrt(sum / this.time.length);
  }

  click() {
    this.clicks += 1;
    if (this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 2100 + Math.random() * 500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.004);
    gain.gain.setValueAtTime(0.22, now + 0.028);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start(now);
    osc.stop(now + 0.4);
    this.burst(2600, 1.3, 0.3, 0.04);
  }

  flip() {
    if (this.muted) return;
    this.tick(1800 + Math.random() * 600, 0.2, 0.01);
    this.tick(900 + Math.random() * 300, 0.16, 0.016, 0.032);
  }

  clunk() {
    if (this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150 + Math.random() * 30, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.1);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start(now);
    osc.stop(now + 0.35);
    this.burst(420, 1.4, 0.28, 0.08);
  }

  detent() {
    const now = performance.now();
    if (now - this.lastDetent < 38) return;
    this.lastDetent = now;
    this.tick(3000 + Math.random() * 1400, 0.11, 0.007);
  }

  tick(freq, amp, dur, delay = 0) {
    if (this.muted) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start(now);
    // Stop well after the envelope. A tight stop is skipped when the audio thread is busy.
    osc.stop(now + 0.3);
    this.burst(freq, 1.6, amp * 0.7, dur, delay);
  }

  burst(freq, q, amp, dur, delay = 0) {
    const now = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.out);
    src.start(now, Math.random() * 0.2);
    src.stop(now + 0.3);
  }
}
