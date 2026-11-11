// Sound Kitchen Cafe sound engine. Everything is synthesized with Web Audio; there are no samples.
// Layers are built lazily, routed through their own gain into a shared mix bus, and
// detached again when silent so idle layers cost nothing.

const R = (a, b) => a + Math.random() * (b - a);
const expR = (a, b) => a * (b / a) ** Math.random();
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const midi = (note) => 440 * 2 ** ((note - 69) / 12);

const NOISE_SECONDS = { white: 7.3, pink: 11.1, brown: 13.7 };
const TAPER = 1.7;

// Relative loudness of each layer at full level, balanced from offline renders.
const TRIM = {
  white: 0.4, pink: 0.45, brown: 0.48, rain: 1.05, thunder: 2.2, wind: 0.85, ocean: 0.82,
  fire: 0.63, insects: 0.8, cafe: 1.7, fan: 1.2, train: 0.65, vinyl: 1.85, pad: 0.55, drone: 0.23,
};

const VOWELS = [
  [730, 1090], [570, 840], [300, 870], [270, 2290], [390, 1990], [530, 1840],
  [660, 1720], [440, 1020], [640, 1190], [490, 1350],
];

const CHORDS = [
  { bass: 38, notes: [57, 61, 64, 66] },
  { bass: 35, notes: [57, 61, 62, 66] },
  { bass: 43, notes: [57, 59, 62, 66] },
  { bass: 40, notes: [55, 59, 62, 66] },
  { bass: 45, notes: [55, 59, 61, 66] },
  { bass: 42, notes: [57, 61, 64, 69] },
];

function fillNoise(kind, data) {
  const n = data.length;
  if (kind === "white") {
    for (let i = 0; i < n; i += 1) data[i] = Math.random() * 2 - 1;
  } else if (kind === "brown") {
    let last = 0;
    for (let i = 0; i < n; i += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last;
    }
  } else {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i += 1) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  }
}

// Filtered noise carries state across the loop point, so generate a little extra and
// crossfade the tail into the head. The loop then has no click and no level dip.
function seamlessNoise(kind, length, fade) {
  const raw = new Float32Array(length + fade);
  fillNoise(kind, raw);
  const out = new Float32Array(length);
  out.set(raw.subarray(0, length));
  if (kind !== "white") {
    for (let i = 0; i < fade; i += 1) {
      const a = (i / fade) * Math.PI * 0.5;
      out[i] = raw[i] * Math.sin(a) + raw[length + i] * Math.cos(a);
    }
  }
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += out[i] * out[i];
  const norm = 0.25 / Math.sqrt(sum / length || 1);
  for (let i = 0; i < length; i += 1) out[i] *= norm;
  return out;
}

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.buffers = new Map();
    this.layers = new Map();
    this.levels = {};
    this.playing = false;
    this.masterLevel = 0.7;
    this.timer = null;

    this.mix = this.g(1);
    this.tone = this.bq("lowpass", 20000, 0.5);
    this.master = this.g(0);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.02;
    this.comp.release.value = 0.3;
    this.chain(this.mix, this.tone, this.master, this.comp, ctx.destination);

    // Control sounds bypass the mix, tone, master and compressor entirely.
    this.sfxBus = this.g(1);
    this.sfxBus.connect(ctx.destination);

    const split = ctx.createChannelSplitter(2);
    this.comp.connect(split);
    const meterSink = this.g(0);
    meterSink.connect(ctx.destination);
    this.meters = [0, 1].map((channel) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      split.connect(analyser, channel);
      analyser.connect(meterSink);
      return { analyser, data: new Float32Array(analyser.fftSize) };
    });
    this.probeSink = this.g(0);
    this.probeSink.connect(ctx.destination);
    this.probes = new Map();
  }

  // ---- node helpers ----
  g(value) {
    const node = this.ctx.createGain();
    node.gain.value = value;
    return node;
  }

  bq(type, frequency, q = 0.707) {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  pan(value) {
    const node = this.ctx.createStereoPanner();
    node.pan.value = value;
    return node;
  }

  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  osc(type, frequency, detune = 0) {
    const node = this.ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.detune.value = detune;
    node.start();
    return node;
  }

  loop(buffer, rate = 1) {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.playbackRate.value = rate;
    node.start(0, Math.random() * buffer.duration);
    return node;
  }

  noiseBuffer(kind) {
    if (!this.buffers.has(kind)) {
      const length = Math.floor(NOISE_SECONDS[kind] * this.sr);
      const buffer = this.ctx.createBuffer(2, length, this.sr);
      for (let c = 0; c < 2; c += 1) buffer.copyToChannel(seamlessNoise(kind, length, Math.floor(this.sr * 0.25)), c);
      this.buffers.set(kind, buffer);
    }
    return this.buffers.get(kind);
  }

  // Looping stereo noise from a random phase, so every use is decorrelated from the others.
  src(kind, rate = 1) {
    return this.loop(this.noiseBuffer(kind), rate);
  }

  // Slow smooth random control signal in [-1, 1]. `rate` is roughly wiggles per second.
  wander(rate) {
    const index = Math.floor(Math.random() * 4);
    const key = `wander${index}`;
    if (!this.buffers.has(key)) {
      const sr = 8000;
      const points = 32;
      const length = sr * 4;
      const buffer = this.ctx.createBuffer(1, length, sr);
      const data = buffer.getChannelData(0);
      const values = Array.from({ length: points }, () => Math.random() * 2 - 1);
      for (let i = 0; i < length; i += 1) {
        const pos = (i / length) * points;
        const a = Math.floor(pos);
        const f = (1 - Math.cos((pos - a) * Math.PI)) * 0.5;
        data[i] = values[a] * (1 - f) + values[(a + 1) % points] * f;
      }
      this.buffers.set(key, buffer);
    }
    return this.loop(this.buffers.get(key), (rate / 8) * R(0.85, 1.15));
  }

  mod(param, rate, depth) {
    this.chain(this.wander(rate), this.g(depth), param);
  }

  impulse(kind) {
    const key = `ir-${kind}`;
    if (!this.buffers.has(key)) {
      const seconds = kind === "hall" ? 3.4 : 0.9;
      const length = Math.floor(seconds * this.sr);
      const buffer = this.ctx.createBuffer(2, length, this.sr);
      for (let c = 0; c < 2; c += 1) {
        const data = buffer.getChannelData(c);
        let lp = 0;
        let energy = 0;
        for (let i = 0; i < length; i += 1) {
          const t = i / length;
          const env = Math.exp(-t * (kind === "hall" ? 5.5 : 6.5)) * Math.min(1, i / (this.sr * 0.004));
          const k = 0.75 - 0.6 * t;
          lp += k * ((Math.random() * 2 - 1) - lp);
          data[i] = lp * env;
          energy += data[i] * data[i];
        }
        const norm = 1 / Math.sqrt(energy);
        for (let i = 0; i < length; i += 1) data[i] *= norm;
      }
      this.buffers.set(key, buffer);
    }
    return this.buffers.get(key);
  }

  // Reverb send that returns into the layer itself, so the layer dial scales dry and wet together.
  wet(out, kind, amount) {
    const send = this.g(1);
    const conv = this.ctx.createConvolver();
    conv.buffer = this.impulse(kind);
    this.chain(send, conv, this.g(amount), out);
    return send;
  }

  // Stereo buffer of sparse one-shot events written with wraparound, so it loops without a seam.
  eventBuffer(seconds, write) {
    const length = Math.floor(seconds * this.sr);
    const buffer = this.ctx.createBuffer(2, length, this.sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const add = (time, panValue, samples) => {
      const start = Math.floor(time * this.sr);
      const gl = Math.cos((panValue + 1) * Math.PI * 0.25);
      const gr = Math.sin((panValue + 1) * Math.PI * 0.25);
      for (let i = 0; i < samples.length; i += 1) {
        const at = (start + i) % length;
        left[at] += samples[i] * gl;
        right[at] += samples[i] * gr;
      }
    };
    write(add, seconds);
    return buffer;
  }

  ping(dest, time, { freq, to, dur, gain, type = "sine", attack = 0.003 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (to) o.frequency.exponentialRampToValueAtTime(to, time + dur);
    const e = this.g(0);
    e.gain.setValueAtTime(0, time);
    e.gain.linearRampToValueAtTime(gain, time + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    this.chain(o, e, dest);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  hit(dest, time, { kind = "white", type = "bandpass", freq, q = 1, dur, gain, attack = 0.002 }) {
    const s = this.ctx.createBufferSource();
    const buffer = this.noiseBuffer(kind);
    s.buffer = buffer;
    const e = this.g(0);
    e.gain.setValueAtTime(0, time);
    e.gain.linearRampToValueAtTime(gain, time + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    this.chain(s, this.bq(type, freq, q), e, dest);
    s.start(time, Math.random() * (buffer.duration - dur - 0.1), dur + 0.05);
  }

  // ---- layer builders ----
  buildLayer(id) {
    const out = this.g(1);
    const layer = { out, next: 0 };
    this[`build_${id}`](out, layer);
    return layer;
  }

  build_white(out) { this.src("white").connect(out); }
  build_pink(out) { this.src("pink").connect(out); }
  build_brown(out) { this.src("brown").connect(out); }

  build_rain(out) {
    const body = this.g(0.55);
    this.chain(this.src("pink"), this.bq("highpass", 420, 0.5), this.bq("lowpass", 8500, 0.5), body, out);
    this.mod(body.gain, 0.09, 0.1);
    const hiss = this.g(0.1);
    this.chain(this.src("white"), this.bq("bandpass", 6200, 0.6), hiss, out);
    this.mod(hiss.gain, 0.13, 0.045);
    const roof = this.g(0.32);
    this.chain(this.src("brown"), this.bq("bandpass", 260, 0.7), roof, out);
    this.mod(roof.gain, 0.07, 0.09);

    const drops = (seconds, perSecond, low, high) => this.eventBuffer(seconds, (add, total) => {
      const count = Math.floor(total * perSecond);
      for (let k = 0; k < count; k += 1) {
        const freq = expR(low, high);
        const tau = R(0.0015, 0.007);
        const amp = 0.03 + 0.5 * Math.random() ** 3;
        const n = Math.floor(tau * 6 * this.sr);
        const samples = new Float32Array(n);
        const phase = Math.random() * 6.283;
        for (let i = 0; i < n; i += 1) {
          const t = i / this.sr;
          const env = Math.min(1, i / 12) * Math.exp(-t / tau);
          samples[i] = amp * env * (0.55 * Math.sin(6.283 * freq * t + phase) + 0.45 * (Math.random() * 2 - 1));
        }
        add(Math.random() * total, R(-1, 1), samples);
      }
    });
    const plops = this.eventBuffer(15.7, (add, total) => {
      for (let k = 0; k < total * 2.2; k += 1) {
        const f0 = R(420, 900);
        const dur = R(0.018, 0.04);
        const amp = 0.04 + 0.16 * Math.random() ** 2;
        const n = Math.floor(dur * this.sr);
        const samples = new Float32Array(n);
        let phase = 0;
        for (let i = 0; i < n; i += 1) {
          const u = i / n;
          phase += (6.283 * f0 * (1 + 1.3 * u)) / this.sr;
          samples[i] = amp * Math.sin(phase) * Math.sin(Math.PI * u) ** 1.5;
        }
        add(Math.random() * total, R(-0.9, 0.9), samples);
      }
    });
    this.chain(this.loop(drops(9.7, 26, 2200, 8000)), this.g(0.8), out);
    this.chain(this.loop(drops(13.3, 15, 1200, 4200)), this.bq("lowpass", 5000), this.g(0.7), out);
    this.chain(this.loop(plops), this.g(0.7), out);
  }

  build_thunder(out, layer) {
    const send = this.wet(out, "hall", 0.5);
    const far = this.g(0.1);
    this.chain(this.src("brown"), this.bq("lowpass", 90), far, out);
    this.mod(far.gain, 0.15, 0.08);
    layer.first = 1.2;
    layer.tick = (from, to) => {
      while (layer.next < to) {
        const t = Math.max(layer.next, from);
        const close = Math.random();
        const dur = R(5, 9);
        const peak = 0.55 + 0.85 * close;
        const s = this.ctx.createBufferSource();
        const buffer = this.noiseBuffer("brown");
        s.buffer = buffer;
        s.loop = true;
        s.playbackRate.value = R(0.5, 0.9);
        const lp = this.bq("lowpass", 100, 0.6);
        lp.frequency.setValueAtTime(R(500, 1300) * (0.4 + close), t);
        lp.frequency.exponentialRampToValueAtTime(70, t + dur);
        const env = this.g(0);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peak, t + R(0.03, 0.35) * (1.3 - close));
        let at = t + 0.4;
        const rolls = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < rolls; i += 1) {
          at += R(0.25, 0.9);
          env.gain.linearRampToValueAtTime(peak * R(0.25, 0.95) * 0.82 ** i, at);
        }
        env.gain.exponentialRampToValueAtTime(0.0001, Math.max(at + 1.5, t + dur));
        const p = this.pan(R(-0.6, 0.6));
        this.chain(s, lp, env, p, out);
        p.connect(send);
        const end = Math.max(at + 1.5, t + dur) + 0.1;
        s.start(t, Math.random() * buffer.duration);
        s.stop(end);
        if (close > 0.5) {
          const crack = this.g(0);
          let ct = t;
          crack.gain.setValueAtTime(0, ct);
          for (let i = 0; i < 4; i += 1) {
            ct += R(0.012, 0.05);
            crack.gain.linearRampToValueAtTime(close * R(0.25, 0.7), ct);
            ct += R(0.01, 0.04);
            crack.gain.linearRampToValueAtTime(close * 0.08, ct);
          }
          crack.gain.exponentialRampToValueAtTime(0.0001, ct + 0.7);
          const cs = this.ctx.createBufferSource();
          cs.buffer = this.noiseBuffer("white");
          this.chain(cs, this.bq("highpass", 700, 0.5), this.bq("lowpass", 5500, 0.5), crack, p);
          cs.start(t, Math.random() * 5, 1.2);
        }
        layer.next = t + R(13, 36);
      }
    };
  }

  build_wind(out) {
    for (const [freq, position, rate] of [[380, -0.55, 0.11], [640, 0.5, 0.083]]) {
      const bp = this.bq("bandpass", freq, 1.1);
      this.mod(bp.frequency, rate, freq * 0.45);
      const level = this.g(0.5);
      this.mod(level.gain, rate * 1.7, 0.32);
      this.chain(this.src("pink"), bp, level, this.pan(position), out);
    }
    const whistle = this.bq("bandpass", 950, 14);
    this.mod(whistle.frequency, 0.1, 380);
    const wl = this.g(0.05);
    this.mod(wl.gain, 0.21, 0.05);
    this.chain(this.src("white"), whistle, wl, this.pan(0.15), out);
    const low = this.g(0.5);
    this.mod(low.gain, 0.12, 0.3);
    this.chain(this.src("brown"), this.bq("lowpass", 140), low, out);
  }

  build_ocean(out, layer) {
    const rumble = this.g(0.42);
    this.chain(this.src("brown"), this.bq("lowpass", 170), rumble, out);
    this.mod(rumble.gain, 0.06, 0.12);
    const wash = this.g(0.07);
    this.chain(this.src("pink"), this.bq("lowpass", 900, 0.5), wash, out);
    this.mod(wash.gain, 0.05, 0.03);
    const voices = [0, 1, 2].map(() => {
      const lp = this.bq("lowpass", 300, 0.4);
      const env = this.g(0);
      const position = this.pan(0);
      this.chain(this.src("pink"), lp, env, position, out);
      const foam = this.g(0);
      this.chain(this.src("white"), this.bq("highpass", 2200, 0.5), this.bq("lowpass", 7500, 0.5), foam, position);
      return { lp, env, foam, position };
    });
    let index = 0;
    layer.first = 0.3;
    layer.tick = (from, to) => {
      while (layer.next < to) {
        const t = Math.max(layer.next, from);
        const v = voices[index % voices.length];
        index += 1;
        const build = R(2.8, 4.6);
        const peak = R(0.55, 1);
        const fall = R(4.5, 7.5);
        v.lp.frequency.cancelScheduledValues(t);
        v.lp.frequency.setTargetAtTime(R(1300, 2600), t, build / 2.4);
        v.lp.frequency.setTargetAtTime(320, t + build, fall / 3);
        v.env.gain.cancelScheduledValues(t);
        v.env.gain.setTargetAtTime(peak, t, build / 2.8);
        v.env.gain.setTargetAtTime(0.0, t + build + 0.15, fall / 3.2);
        v.foam.gain.cancelScheduledValues(t);
        v.foam.gain.setTargetAtTime(peak * 0.42, t + build - 0.5, 0.3);
        v.foam.gain.setTargetAtTime(0, t + build + 0.6, fall / 2.6);
        const from0 = R(-0.7, 0.7);
        v.position.pan.cancelScheduledValues(t);
        v.position.pan.setTargetAtTime(from0, t, 0.5);
        v.position.pan.setTargetAtTime(from0 * -0.4, t + build, fall / 2);
        layer.next = t + R(5.5, 9.5);
      }
    };
  }

  build_fire(out, layer) {
    const roar = this.g(0.8);
    this.chain(this.src("brown"), this.bq("bandpass", 170, 0.5), this.bq("lowpass", 520), roar, out);
    this.mod(roar.gain, 2.6, 0.24);
    this.mod(roar.gain, 0.2, 0.16);
    const mid = this.g(0.07);
    this.chain(this.src("pink"), this.bq("bandpass", 1100, 0.7), mid, out);
    this.mod(mid.gain, 4, 0.05);

    const crackle = (seconds, perSecond) => this.eventBuffer(seconds, (add, total) => {
      let t = 0;
      let busy = 1;
      while (t < total) {
        if (Math.random() < 0.08) busy = Math.random() < 0.5 ? 3.5 : 0.5;
        t += (-Math.log(1 - Math.random()) / perSecond) / busy;
        const amp = 0.04 + 0.9 * Math.random() ** 4;
        const tau = R(0.0002, 0.0018) * (1 + amp * 2);
        const n = Math.floor(tau * 7 * this.sr) + 8;
        const samples = new Float32Array(n);
        const ring = R(1500, 3600);
        let prev = 0;
        for (let i = 0; i < n; i += 1) {
          const time = i / this.sr;
          const white = Math.random() * 2 - 1;
          const hp = white - prev * 0.6;
          prev = white;
          samples[i] = amp * Math.exp(-time / tau) * (0.75 * hp + 0.5 * amp * Math.sin(6.283 * ring * time));
        }
        add(t % total, R(-0.8, 0.8), samples);
      }
    });
    const crack = this.bq("highpass", 650, 0.5);
    this.loop(crackle(7.3, 9)).connect(crack);
    this.loop(crackle(11.9, 5)).connect(crack);
    this.chain(crack, this.g(0.95), out);

    layer.first = 2;
    layer.tick = (from, to) => {
      while (layer.next < to) {
        const t = Math.max(layer.next, from);
        const p = this.pan(R(-0.5, 0.5));
        p.connect(out);
        const amp = R(0.3, 0.8);
        this.hit(p, t, { freq: R(1800, 3200), q: 0.9, dur: R(0.01, 0.03), gain: amp });
        this.ping(p, t, { freq: R(120, 170), to: 60, dur: 0.07, gain: amp * 0.4 });
        if (Math.random() < 0.4) this.hit(p, t + R(0.04, 0.12), { freq: R(2200, 4200), q: 1.2, dur: 0.012, gain: amp * 0.6 });
        layer.next = t + R(2.5, 10);
      }
    };
  }

  build_fan(out) {
    const air = this.g(0.55);
    this.chain(this.src("pink"), this.bq("bandpass", 480, 0.45), this.bq("lowpass", 3200), air, out);
    this.chain(this.osc("sine", 12.6), this.g(0.04), air.gain);
    this.chain(this.osc("sine", 6.3), this.g(0.022), air.gain);
    this.mod(air.gain, 0.15, 0.03);
    const high = this.g(0.035);
    this.chain(this.src("white"), this.bq("highpass", 3500, 0.5), high, out);
    for (const [freq, level] of [[49, 0.035], [98, 0.07], [196, 0.032], [294, 0.014], [392, 0.006]]) {
      this.chain(this.osc("sine", freq), this.g(level), this.pan(-0.6), out);
      this.chain(this.osc("sine", freq * 1.0013), this.g(level), this.pan(0.6), out);
    }
  }

  build_cafe(out, layer) {
    const bus = this.g(1);
    const soften = this.bq("lowpass", 2500, 0.5);
    this.chain(bus, soften, this.g(0.6), out);
    soften.connect(this.wet(out, "room", 0.75));
    this.chain(this.src("brown"), this.bq("lowpass", 320), this.g(0.24), out);
    const murmur = this.g(0.07);
    this.chain(this.src("pink"), this.bq("bandpass", 620, 0.6), murmur, out);
    this.mod(murmur.gain, 0.3, 0.03);

    const voices = Array.from({ length: 10 }, (_, i) => {
      const f0 = i % 2 ? R(165, 235) : R(92, 135);
      const o = this.osc("sawtooth", f0);
      const env = this.g(0);
      const f1 = this.bq("bandpass", 500, 5);
      const f2 = this.bq("bandpass", 1500, 7);
      const level = this.g(R(0.35, 0.9));
      const position = this.pan(R(-0.95, 0.95));
      o.connect(env);
      this.chain(env, f1, level);
      this.chain(env, f2, this.g(0.55), level);
      this.chain(level, position, bus);
      return { o, env, f1, f2, f0, next: R(0, 2.5) };
    });
    const clinkBus = this.g(1);
    clinkBus.connect(out);
    clinkBus.connect(this.wet(out, "room", 0.5));
    layer.first = 0;
    let clinkAt = 3;
    let lastTo = null;
    layer.tick = (from, to) => {
      if (lastTo === null || from - lastTo > 1) {
        clinkAt = from + R(1.5, 4);
        for (const v of voices) v.next = from + R(0, 2.5);
      }
      lastTo = to;
      layer.next = to;
      for (const v of voices) {
        while (v.next < to) {
          let t = Math.max(v.next, from);
          const count = 2 + Math.floor(Math.random() * 10);
          const pitch = v.f0 * R(0.94, 1.16);
          const loud = R(0.5, 1);
          for (let i = 0; i < count; i += 1) {
            const dur = R(0.11, 0.27);
            const [a, b] = pick(VOWELS);
            v.f1.frequency.setTargetAtTime(a * R(0.9, 1.1), t, 0.02);
            v.f2.frequency.setTargetAtTime(b * R(0.9, 1.1), t, 0.02);
            v.o.frequency.setTargetAtTime(pitch * (1 - (0.14 * i) / count) * R(0.96, 1.06), t, 0.03);
            v.env.gain.setTargetAtTime(loud * R(0.45, 1), t, 0.018);
            v.env.gain.setTargetAtTime(0.03, t + dur * 0.62, 0.03);
            t += dur + (Math.random() < 0.15 ? R(0.08, 0.25) : 0);
          }
          v.env.gain.setTargetAtTime(0, t, 0.05);
          v.next = t + R(0.4, 4);
        }
      }
      while (clinkAt < to) {
        const t = Math.max(clinkAt, from);
        const p = this.pan(R(-0.8, 0.8));
        p.connect(clinkBus);
        const base = R(1900, 3400);
        const taps = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
        for (let k = 0; k < taps; k += 1) {
          const at = t + k * R(0.11, 0.2);
          const amp = R(0.02, 0.07) / (1 + k * 0.4);
          for (const [ratio, part] of [[1, 1], [2.32, 0.5], [3.85, 0.25]]) {
            this.ping(p, at, { freq: base * ratio * R(0.995, 1.005), dur: R(0.06, 0.2) / ratio ** 0.5, gain: amp * part, attack: 0.001 });
          }
        }
        clinkAt = t + R(2.5, 9);
      }
    };
  }

  build_insects(out) {
    const amBuffer = (period, pulses, pulseLen, gap) => {
      const length = Math.floor(period * this.sr);
      const buffer = this.ctx.createBuffer(1, length, this.sr);
      const data = buffer.getChannelData(0);
      for (let p = 0; p < pulses; p += 1) {
        const start = Math.floor(p * (pulseLen + gap) * this.sr);
        const n = Math.floor(pulseLen * this.sr);
        for (let i = 0; i < n && start + i < length; i += 1) {
          data[start + i] = (0.5 - 0.5 * Math.cos((6.283 * i) / n)) * (0.7 + 0.3 * (p / Math.max(1, pulses - 1)));
        }
      }
      return buffer;
    };
    const pair = (freq, spread, dest) => {
      this.chain(this.osc("sine", freq), this.pan(-0.9), dest);
      this.chain(this.osc("sine", freq + spread), this.pan(0.9), dest);
    };
    for (let i = 0; i < 7; i += 1) {
      const am = this.g(0);
      const pulses = 2 + Math.floor(Math.random() * 3);
      this.loop(amBuffer(R(0.36, 0.8), pulses, R(0.011, 0.018), R(0.012, 0.02))).connect(am.gain);
      const level = this.g(0.5);
      this.mod(level.gain, 0.06, 0.16);
      pair(R(4300, 5600), R(7, 24), am);
      this.chain(am, level, out);
    }
    for (const [freq, rate] of [[3150, 37], [2780, 44]]) {
      const trill = this.g(0.5);
      this.chain(this.osc("sine", rate), this.g(0.5), trill.gain);
      const level = this.g(0.1);
      this.mod(level.gain, 0.05, 0.04);
      pair(freq, 11, trill);
      this.chain(trill, level, out);
    }
    const katydid = this.g(0);
    this.loop(amBuffer(1.37, 3, 0.05, 0.09)).connect(katydid.gain);
    const kl = this.g(0.55);
    this.mod(kl.gain, 0.04, 0.18);
    const delay = this.ctx.createDelay(0.05);
    delay.delayTime.value = 0.008;
    this.chain(this.src("white"), this.bq("bandpass", 8200, 5), katydid, kl);
    this.chain(kl, this.pan(-0.65), out);
    this.chain(kl, delay, this.pan(0.85), out);
    this.chain(this.src("pink"), this.bq("lowpass", 500), this.g(0.07), out);
  }

  build_train(out, layer) {
    const rumble = this.g(0.85);
    this.chain(this.src("brown"), this.bq("lowpass", 120), rumble, out);
    this.mod(rumble.gain, 0.3, 0.16);
    const body = this.bq("bandpass", 310, 1.2);
    this.mod(body.frequency, 0.2, 60);
    const bodyLevel = this.g(0.2);
    this.mod(bodyLevel.gain, 0.4, 0.07);
    this.chain(this.src("pink"), body, bodyLevel, out);
    this.chain(this.src("pink"), this.bq("highpass", 1800, 0.5), this.bq("lowpass", 5000, 0.5), this.g(0.03), out);
    const clacks = this.bq("lowpass", 2600, 0.5);
    clacks.connect(out);
    const left = this.pan(-0.3);
    const right = this.pan(0.3);
    left.connect(clacks);
    right.connect(clacks);
    const clack = (t, amp, dest) => {
      this.ping(dest, t, { freq: 95, to: 46, dur: 0.09, gain: amp * 0.7 });
      this.hit(dest, t, { freq: R(1300, 1700), q: 1.2, dur: 0.035, gain: amp * 0.3 });
      this.ping(dest, t, { freq: R(1900, 2300), dur: 0.04, gain: amp * 0.025, attack: 0.001 });
    };
    layer.first = 0.4;
    layer.tick = (from, to) => {
      while (layer.next < to) {
        const t = Math.max(layer.next, from);
        const amp = R(0.75, 1);
        clack(t, amp, left);
        clack(t + 0.105, amp * 0.8, left);
        clack(t + 0.37, amp * 0.55, right);
        clack(t + 0.475, amp * 0.45, right);
        layer.next = t + 1.34 + 0.09 * Math.sin(t * 0.07) + R(-0.012, 0.012);
      }
    };
  }

  build_vinyl(out) {
    const clicks = (seconds, perSecond) => this.eventBuffer(seconds, (add, total) => {
      for (let k = 0; k < total * perSecond; k += 1) {
        const amp = 0.02 + 0.6 * Math.random() ** 5;
        const pop = Math.random() < 0.06;
        const tau = pop ? R(0.001, 0.003) : R(0.00008, 0.0005);
        const n = Math.floor(tau * 7 * this.sr) + 6;
        const samples = new Float32Array(n);
        const sign = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < n; i += 1) {
          const time = i / this.sr;
          samples[i] = sign * amp * Math.exp(-time / tau) * (pop ? Math.sin(6.283 * 190 * time) + 0.5 * (i % 2 ? -1 : 1) : (i % 2 ? -0.7 : 1));
        }
        add(Math.random() * total, R(-0.45, 0.45), samples);
      }
    });
    this.chain(this.loop(clicks(17.1, 4)), out);
    this.chain(this.loop(clicks(23.7, 2.2)), out);
    this.chain(this.src("pink"), this.bq("highpass", 1800, 0.5), this.g(0.04), out);
    const rumble = this.g(0.22);
    this.chain(this.src("brown"), this.bq("lowpass", 70), rumble, out);
    this.chain(this.osc("sine", 0.555), this.g(0.07), rumble.gain);
  }

  build_pad(out, layer) {
    const lp = this.bq("lowpass", 950, 0.6);
    this.mod(lp.frequency, 0.07, 320);
    this.chain(lp, this.g(0.5), out);
    const send = this.wet(out, "hall", 0.7);
    lp.connect(send);
    const wow = this.g(9);
    this.wander(0.35).connect(wow);
    const flutter = this.g(2.2);
    this.osc("sine", 5.5).connect(flutter);
    const voice = (type, level) => {
      const gain = this.g(0);
      const oscs = [-1, 1].map((side) => {
        const o = this.osc(type, 220, side * 6);
        wow.connect(o.detune);
        flutter.connect(o.detune);
        this.chain(o, this.pan(side * 0.5), gain);
        return o;
      });
      gain.connect(lp);
      return { oscs, gain, level, note: null };
    };
    const voices = [voice("triangle", 0.2), voice("triangle", 0.2), voice("triangle", 0.18), voice("triangle", 0.16)];
    const bass = voice("sine", 0.34);
    const keys = this.bq("lowpass", 1900, 0.5);
    keys.connect(out);
    keys.connect(send);
    let chord = null;
    let keysAt = 0;
    const move = (v, note, t) => {
      if (v.note === note) return;
      const first = v.note === null;
      v.note = note;
      const swap = first ? t : t + 1.5;
      if (!first) v.gain.gain.setTargetAtTime(0, t, 0.45);
      for (const o of v.oscs) o.frequency.setValueAtTime(midi(note), swap);
      v.gain.gain.setTargetAtTime(v.level, swap, first ? 1.2 : 0.9);
    };
    layer.first = 0;
    layer.tick = (from, to) => {
      if (keysAt < from - 1) keysAt = from + R(3, 6);
      while (layer.next < to) {
        const t = Math.max(layer.next, from);
        chord = pick(CHORDS.filter((c) => c !== chord));
        voices.forEach((v, i) => move(v, chord.notes[i], t + (chord && i ? i * R(0.3, 0.8) : 0)));
        move(bass, chord.bass, t + 0.2);
        layer.next = t + R(9, 15);
      }
      while (keysAt < to && chord) {
        const t = Math.max(keysAt, from);
        const p = this.pan(R(-0.5, 0.5));
        p.connect(keys);
        const count = Math.random() < 0.45 ? 2 : 1;
        for (let k = 0; k < count; k += 1) {
          const note = pick(chord.notes) + (Math.random() < 0.6 ? 12 : 0);
          const at = t + k * R(0.28, 0.6);
          const amp = R(0.05, 0.11);
          this.ping(p, at, { freq: midi(note), dur: R(1.8, 3), gain: amp, attack: 0.006 });
          this.ping(p, at, { freq: midi(note) * 2, dur: 0.7, gain: amp * 0.22, attack: 0.004 });
        }
        keysAt = t + R(2.5, 7.5);
      }
    };
  }

  build_drone(out) {
    const lp = this.bq("lowpass", 700, 0.5);
    lp.connect(out);
    lp.connect(this.wet(out, "hall", 0.4));
    for (const [ratio, level] of [[0.5, 0.26], [1, 0.5], [1.5, 0.22], [2, 0.3], [3, 0.11], [4, 0.07]]) {
      const freq = 55 * ratio;
      const part = this.g(level);
      this.mod(part.gain, 0.05, level * 0.5);
      this.chain(this.osc("sine", freq), this.pan(-0.7), part);
      this.chain(this.osc("sine", freq + R(0.07, 0.3)), this.pan(0.7), part);
      part.connect(lp);
    }
    for (const [freq, q, level] of [[220, 2.5, 0.13], [440, 4, 0.05]]) {
      const breath = this.g(level);
      this.mod(breath.gain, 0.08, level * 0.7);
      this.chain(this.src("pink"), this.bq("bandpass", freq, q), breath, out);
    }
  }

  // ---- control surface ----
  setLevel(id, value, ramp = 0.08) {
    this.levels[id] = value;
    let layer = this.layers.get(id);
    if (value <= 0 && !layer) return;
    if (!layer) {
      layer = this.buildLayer(id);
      layer.level = this.g(0);
      layer.out.connect(layer.level);
      layer.connected = false;
      this.layers.set(id, layer);
    }
    const now = this.ctx.currentTime;
    if (value > 0 && !layer.connected) {
      layer.level.connect(this.mix);
      layer.connected = true;
      layer.next = now + (layer.first ?? 0);
    }
    layer.level.gain.cancelScheduledValues(now);
    layer.level.gain.setTargetAtTime((value / 100) ** TAPER * TRIM[id], now, ramp);
    clearTimeout(layer.idle);
    if (value <= 0) {
      layer.idle = setTimeout(() => {
        if (this.levels[id] > 0 || !layer.connected) return;
        layer.level.disconnect(this.mix);
        layer.connected = false;
      }, 1500);
    }
  }

  setMaster(value) {
    this.masterLevel = value / 100;
    this.applyMaster(0.03);
  }

  // 0 is dark and muffled, 100 leaves the mix untouched.
  setTone(value) {
    const now = this.ctx.currentTime;
    const freq = 500 * (20000 / 500) ** (value / 100);
    this.tone.frequency.cancelScheduledValues(now);
    this.tone.frequency.setTargetAtTime(freq, now, 0.03);
  }

  applyMaster(ramp) {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.playing ? this.masterLevel ** 1.5 : 0, now, ramp);
  }

  setPlaying(on) {
    this.playing = on;
    this.applyMaster(on ? 0.12 : 0.06);
    if (on) this.tick();
  }

  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    for (const layer of this.layers.values()) {
      if (!layer.tick || !layer.connected) continue;
      if (layer.next < now - 0.5) layer.next = now + (layer.first ?? 0);
      layer.tick(now + 0.02, now + 0.4);
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 120);
  }

  // Post-compressor stereo level, for the front panel meter.
  meter() {
    return this.meters.map(({ analyser, data }) => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length);
    });
  }

  // RMS of a single layer after its level dial, used to check that a layer is really producing signal.
  probe(id) {
    const layer = this.layers.get(id);
    if (!layer) return 0;
    if (!this.probes.has(id)) {
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 2048;
      layer.level.connect(analyser);
      analyser.connect(this.probeSink);
      this.probes.set(id, { analyser, data: new Float32Array(analyser.fftSize) });
    }
    const { analyser, data } = this.probes.get(id);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }
}
