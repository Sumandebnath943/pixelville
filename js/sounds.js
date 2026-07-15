/* ============================================================
   PixelVille — procedural audio. No files: everything is
   synthesized with WebAudio. Starts on first user gesture.
   Ambience: wind, birdsong, crickets, rain, thunder.
   Events: placement, bulldoze, bells, siren, fireworks.
   ============================================================ */
'use strict';

const Snd = {
  ctx: null, master: null, started: false,
  enabled: localStorage.getItem('pixelville-snd') !== '0',
  wind: null, rain: null, crickets: null,
  birdTimer: 3,

  start() {
    if (this.started) return;
    this.started = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(c.destination);

    // shared noise buffer
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const noiseLayer = (type, freq, q) => {
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return g;
    };
    this.wind = noiseLayer('lowpass', 320);
    this.rain = noiseLayer('bandpass', 1600, 0.6);

    // crickets: high sine, amplitude-modulated
    const osc = c.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 4400;
    const am = c.createOscillator();
    am.type = 'square'; am.frequency.value = 5.2;
    const amG = c.createGain(); amG.gain.value = 0.5;
    const cg = c.createGain(); cg.gain.value = 0;
    am.connect(amG.gain);
    osc.connect(amG); amG.connect(cg); cg.connect(this.master);
    osc.start(); am.start();
    this.crickets = cg;
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('pixelville-snd', this.enabled ? '1' : '0');
    if (this.master) this.master.gain.linearRampToValueAtTime(this.enabled ? 0.5 : 0, this.ctx.currentTime + 0.2);
    return this.enabled;
  },

  /* smooth ambience follows the world state; call every frame */
  tick(dt, { dark, rainI, snowI, day }) {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const set = (g, v) => { if (g) g.gain.setTargetAtTime(v, t, 0.6); };
    set(this.wind, 0.028 + snowI * 0.02 + rainI * 0.015);
    set(this.rain, rainI * 0.13);
    const summerish = typeof Weather !== 'undefined' && Weather.season <= 2;
    set(this.crickets, dark > 0.4 && summerish && rainI < 0.2 ? 0.012 : 0);
    // birdsong
    if (day && rainI < 0.4 && (typeof Weather === 'undefined' || Weather.season !== 3)) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) { this.birdTimer = 2.5 + Math.random() * 7; this.chirp(); }
    }
  },

  env(g, t0, a, peak, dec) { // simple attack/decay envelope
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  },
  tone(freq0, freq1, dur, peak, type, delay) {
    if (!this.started || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq0, t0);
    if (freq1) o.frequency.exponentialRampToValueAtTime(freq1, t0 + dur);
    const g = c.createGain();
    this.env(g, t0, 0.012, peak, dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.15);
  },
  noise(dur, peak, freq, type, delay) {
    if (!this.started || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = c.createGain();
    this.env(g, t0, 0.01, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.1);
  },

  chirp() {
    const n = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++)
      this.tone(2300 + Math.random() * 700, 1800 + Math.random() * 300, 0.07, 0.035, 'sine', i * 0.11);
  },
  place() { this.tone(150, 90, 0.1, 0.16, 'sine'); this.noise(0.06, 0.08, 900); },
  crunch() { this.noise(0.16, 0.14, 450); this.tone(90, 55, 0.14, 0.1, 'triangle'); },
  bell() {
    for (let s = 0; s < 2; s++)
      for (const [f, p] of [[523, 0.09], [784, 0.05], [1046, 0.03]])
        this.tone(f, null, 1.6, p, 'sine', s * 1.1);
  },
  thunder() {
    this.noise(1.6, 0.3, 130, 'lowpass', 0.25 + Math.random() * 0.6);
    this.noise(0.9, 0.16, 70, 'lowpass', 1.1 + Math.random() * 0.4);
  },
  siren() {
    for (let i = 0; i < 3; i++) {
      this.tone(700, null, 0.13, 0.045, 'triangle', i * 0.26);
      this.tone(950, null, 0.13, 0.045, 'triangle', i * 0.26 + 0.13);
    }
  },
  launch() { this.noise(0.35, 0.03, 2200, 'highpass'); },
  pop() {
    this.noise(0.1, 0.12, 1200, 'highpass');
    for (let i = 0; i < 4; i++) this.noise(0.04, 0.05, 2600, 'highpass', 0.12 + i * 0.07 + Math.random() * 0.05);
  },
};

// unlock audio on the first interaction anywhere
document.addEventListener('pointerdown', () => Snd.start(), { once: true });
document.addEventListener('keydown', () => Snd.start(), { once: true });
