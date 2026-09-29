// Звуковой движок: всё синтезируется WebAudio (без файлов), позиционный звук (HRTF), реверберация,
// шаги по типу покрытия, фоновые источники (часы, камин, котёл), музыка: эмбиент / погоня / лобби.
const rnd = (a, b) => a + Math.random() * (b - a);

export class Sound {
  constructor() {
    this.ctx = null; this.volume = 0.8; this.musicVol = 0.6;
    this.hbTimer = 0; this.chase = false; this.mode = 'none';
    this.emitters = [];
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.master);
    // реверберация (сгенерированный импульсный отклик)
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.4, 2.2);
    this.wet = c.createGain(); this.wet.gain.value = 0.28;
    this.reverb.connect(this.wet).connect(this.master);
    this.noiseBuf = this.makeNoise(3);
    this.brownBuf = this.makeBrown(4);
    this.startAmbience();
  }

  makeNoise(sec) { const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  makeBrown(sec) { const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate); const d = b.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } return b; }
  impulse(sec, decay) {
    const c = this.ctx, len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1); }
    return b;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVol = v; if (this.musicBus) this.musicBus.gain.value = v; }
  // подвал — гулкий, улица — сухая
  setSpace(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(kind === 'basement' ? 0.55 : kind === 'outside' ? 0.08 : 0.28, t, 0.5);
  }

  setListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position, t = this.ctx.currentTime;
    const fx = -Math.sin(cam.rotation.y), fz = -Math.cos(cam.rotation.y);
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fx, 0, fz, 0, 1, 0); }
    this.listenerPos = p;
  }

  // выход: панорама + отправка в реверберацию
  out(pos, ref = 1.5, wet = 1) {
    const c = this.ctx;
    const g = c.createGain();
    if (pos) {
      const p = c.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 60; p.rolloffFactor = 1.25;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1.2; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y ?? 1.2, pos.z);
      g.connect(p); p.connect(this.sfx);
      // межэтажное глушение: через перекрытие — глухо
      if (this.listenerPos && Math.abs((pos.y ?? 1.2) - this.listenerPos.y) > 2.2) {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
        g.disconnect(); g.connect(lp); lp.connect(p);
      }
    } else g.connect(this.sfx);
    if (wet) { const s = c.createGain(); s.gain.value = wet; g.connect(s); s.connect(this.reverb); }
    return g;
  }

  env(g, t, a, peak, dur, curve = 'exp') {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t + dur);
  }

  noise({ pos, dur = 0.2, f = 1000, q = 1, type = 'bandpass', gain = 0.5, a = 0.004, to = null, delay = 0, brown = false, ref, wet }) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.playbackRate.value = rnd(0.85, 1.15);
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); this.env(g, t, a, gain, dur);
    s.connect(fl).connect(g).connect(this.out(pos, ref, wet));
    s.start(t, rnd(0, 1.5), dur + 0.1);
  }

  tone({ pos, f = 200, to = null, dur = 0.3, type = 'sine', gain = 0.3, a = 0.01, delay = 0, ref, wet, detune = 0, dest }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); this.env(g, t, a, gain, dur);
    o.connect(g).connect(dest || this.out(pos, ref, wet));
    o.start(t); o.stop(t + dur + 0.05);
  }

  // «голос» бабки: пила через форманты, с дрожью
  voice(pos, f0, f1, dur, vowel = 'a', gain = 0.4) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const vib = c.createOscillator(); vib.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = f0 * 0.03; vib.connect(vg).connect(o.frequency);
    const out = c.createGain(); this.env(out, t, 0.05, gain, dur);
    const F = { a: [[800, 7], [1150, 9], [2900, 12]], o: [[450, 7], [800, 9], [2830, 12]], u: [[325, 7], [700, 9], [2530, 12]], e: [[400, 7], [2000, 10], [2550, 12]] }[vowel];
    for (const [ff, q] of F) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; o.connect(bp).connect(out); }
    const breath = c.createBufferSource(); breath.buffer = this.noiseBuf; const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1400; bf.Q.value = 1;
    const bg = c.createGain(); this.env(bg, t, 0.05, gain * 0.15, dur); breath.connect(bf).connect(bg).connect(out);
    out.connect(this.out(pos, 2.5, 0.8));
    o.start(t); vib.start(t); breath.start(t, rnd(0, 1)); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05); breath.stop(t + dur + 0.05);
  }

  step(pos, surface = 'wood', { heavy = false, run = false } = {}) {
    if (!this.ctx) return;
    const k = heavy ? 1.6 : run ? 1.25 : 1;
    if (surface === 'tile') {
      this.noise({ pos, dur: 0.05, f: 3200, q: 2.5, gain: 0.22 * k, type: 'bandpass' });
      this.tone({ pos, f: rnd(180, 230), to: 120, dur: 0.06, gain: 0.12 * k });
    } else if (surface === 'concrete') {
      this.noise({ pos, dur: 0.08, f: 1800, q: 0.8, gain: 0.28 * k, type: 'bandpass' });
      this.noise({ pos, dur: 0.12, f: 5000, q: 0.5, gain: 0.05 * k, type: 'highpass', delay: 0.02 });
    } else if (surface === 'grass') {
      this.noise({ pos, dur: 0.18, f: 2500, q: 0.4, gain: 0.18 * k, type: 'bandpass', a: 0.03 });
    } else {
      this.noise({ pos, dur: 0.1, f: rnd(250, 380), q: 1.2, gain: 0.5 * k, type: 'lowpass', brown: true });
      this.tone({ pos, f: rnd(95, 120), to: 60, dur: 0.09, gain: 0.18 * k });
      if (Math.random() < (heavy ? 0.25 : 0.08)) this.creakTick(pos, 0.3 * k);
    }
    if (heavy) this.noise({ pos, dur: 0.22, f: 1400, q: 0.7, gain: 0.08, type: 'bandpass', a: 0.06, delay: 0.05 }); // шарканье тапок
  }

  creakTick(pos, gain = 0.3) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(rnd(420, 700), t); o.frequency.linearRampToValueAtTime(rnd(300, 500), t + 0.2);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 9;
    const g = c.createGain(); this.env(g, t, 0.02, gain * 0.25, 0.22, 'lin');
    const am = c.createOscillator(); am.frequency.value = rnd(28, 55); const ag = c.createGain(); ag.gain.value = 0.5; am.connect(ag).connect(g.gain);
    o.connect(bp).connect(g).connect(this.out(pos));
    o.start(t); am.start(t); o.stop(t + 0.25); am.stop(t + 0.25);
  }

  // скрип двери: трение (пила с дрожанием частоты) через резонансы
  creak(pos, dur = 0.9, gain = 0.4, pitch = 1) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const base = rnd(55, 85) * pitch;
    o.frequency.setValueAtTime(base, t);
    for (let i = 1; i < 8; i++) o.frequency.linearRampToValueAtTime(base * rnd(0.7, 1.5), t + dur * i / 8);
    const out = c.createGain(); this.env(out, t, 0.05, gain, dur, 'lin');
    for (const [f, q] of [[620, 14], [1350, 16], [2400, 18]]) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rnd(0.9, 1.1); bp.Q.value = q; o.connect(bp).connect(out); }
    out.connect(this.out(pos));
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, pos = null, opt = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'door': this.noise({ pos, dur: 0.05, f: 2800, q: 4, gain: 0.35 }); this.creak(pos, rnd(0.7, 1.1), 0.45); break;
      case 'doorClose':
        this.noise({ pos, dur: 0.22, f: 220, q: 1, gain: 1.0, type: 'lowpass', brown: true });
        this.tone({ pos, f: 85, to: 45, dur: 0.2, gain: 0.5 });
        this.noise({ pos, dur: 0.04, f: 3000, q: 5, gain: 0.3, delay: 0.03 });
        break;
      case 'creak': this.creak(pos, rnd(0.35, 0.6), 0.5, 1.6); break;
      case 'pickup': this.noise({ pos, dur: 0.12, f: 3000, q: 0.6, gain: 0.12, type: 'bandpass', a: 0.02 }); this.tone({ pos, f: 1800, dur: 0.06, type: 'triangle', gain: 0.08 }); break;
      case 'drop': this.noise({ pos, dur: 0.14, f: 500, q: 1, gain: 0.55, type: 'lowpass', brown: true }); this.tone({ pos, f: 150, to: 80, dur: 0.1, gain: 0.25 }); break;
      case 'thud':
        this.noise({ pos, dur: 0.18, f: 600, q: 0.8, gain: 1.0, type: 'lowpass', brown: true });
        this.tone({ pos, f: 120, to: 60, dur: 0.15, gain: 0.4 });
        this.noise({ pos, dur: 0.1, f: 1200, q: 1, gain: 0.3, delay: 0.14 });
        break;
      case 'metal': for (let i = 0; i < 4; i++) this.tone({ pos, f: rnd(900, 2600), dur: rnd(0.3, 0.9), type: 'triangle', gain: 0.09, delay: i * 0.012 }); this.noise({ pos, dur: 0.06, f: 4000, q: 2, gain: 0.4 }); break;
      case 'glass':
        for (let i = 0; i < 10; i++) this.tone({ pos, f: rnd(2500, 7000), dur: rnd(0.08, 0.5), type: 'triangle', gain: 0.09, delay: rnd(0, 0.25) });
        this.noise({ pos, dur: 0.4, f: 6000, q: 0.7, gain: 0.8, type: 'highpass' });
        this.noise({ pos, dur: 0.15, f: 800, q: 0.7, gain: 0.5, type: 'lowpass' });
        break;
      case 'trap':
        this.noise({ pos, dur: 0.08, f: 4000, q: 2, gain: 1.2 });
        for (let i = 0; i < 5; i++) this.tone({ pos, f: rnd(1500, 3500), dur: 0.35, type: 'triangle', gain: 0.1, delay: 0.02 });
        this.tone({ pos, f: 70, to: 35, dur: 0.3, gain: 0.7 });
        for (let i = 0; i < 4; i++) this.noise({ pos, dur: 0.05, f: 5000, q: 3, gain: 0.25, delay: 0.12 + i * 0.07 });
        break;
      case 'locked': for (let i = 0; i < 3; i++) this.noise({ pos, dur: 0.05, f: 2200 + i * 200, q: 6, gain: 0.35, delay: i * 0.09 }); this.tone({ pos, f: 180, dur: 0.08, gain: 0.15, delay: 0.05 }); break;
      case 'unlock': this.noise({ pos, dur: 0.06, f: 3500, q: 5, gain: 0.4 }); this.noise({ pos, dur: 0.08, f: 2000, q: 4, gain: 0.5, delay: 0.14 }); this.tone({ pos, f: 1400, to: 900, dur: 0.1, type: 'square', gain: 0.05, delay: 0.14 }); break;
      case 'boards':
        for (let i = 0; i < 5; i++) { this.noise({ pos, dur: 0.1, f: 400, q: 1, gain: 0.9, type: 'lowpass', delay: i * 0.25, brown: true }); this.tone({ pos, f: 160, to: 80, dur: 0.1, gain: 0.4, delay: i * 0.25 }); }
        this.creak(pos, 1.2, 0.5, 0.7);
        this.noise({ pos, dur: 0.5, f: 900, q: 0.6, gain: 0.5, delay: 1.3, to: 300 });
        break;
      case 'chain': for (let i = 0; i < 8; i++) this.tone({ pos, f: rnd(2500, 4500), dur: 0.12, type: 'triangle', gain: 0.1, delay: i * 0.05 }); this.noise({ pos, dur: 0.1, f: 4500, q: 3, gain: 0.8, delay: 0.45 }); break;
      case 'bolts': for (let i = 0; i < 4; i++) { this.noise({ pos, dur: 0.3, f: 2500, q: 5, gain: 0.3, delay: i * 0.35, a: 0.05 }); this.play('metal', pos); } break;
      case 'grate': this.noise({ pos, dur: 0.8, f: 1200, q: 8, gain: 0.5, a: 0.1, to: 700 }); this.play('metal', pos); this.tone({ pos, f: 60, to: 40, dur: 0.5, gain: 0.5, delay: 0.7 }); break;
      case 'spray': this.noise({ pos, dur: 0.75, f: 7000, q: 0.5, gain: 0.55, type: 'highpass', a: 0.02 }); break;
      case 'swing': this.noise({ pos, dur: 0.35, f: 300, q: 2, gain: 0.8, a: 0.25, to: 2000 }); this.voice(pos, 190, 280, 0.35, 'a', 0.5); break;
      case 'hit': this.tone({ f: 90, to: 28, dur: 0.7, gain: 1.0 }); this.noise({ dur: 0.4, f: 500, q: 0.7, gain: 1.1, type: 'lowpass', brown: true }); this.noise({ dur: 0.08, f: 2500, q: 1, gain: 0.5 }); break;
      case 'spotted':
        this.stinger();
        this.voice(pos, 240, 150, 0.45, 'a', 0.5);
        break;
      case 'hear': this.voice(pos, 190, 260, 0.35, 'u', 0.35); break;
      case 'angry': this.voice(pos, 170, 90, 0.9, 'a', 0.55); this.voice(pos, 185, 95, 0.9, 'o', 0.35); break;
      case 'stun': this.voice(pos, 320, 520, 0.5, 'a', 0.5); this.voice(pos, 520, 180, 0.8, 'e', 0.45); for (let i = 0; i < 3; i++) this.noise({ pos, dur: 0.12, f: 1200, q: 1, gain: 0.3, delay: 0.9 + i * 0.25 }); break;
      case 'pull': this.noise({ pos, dur: 0.5, f: 250, q: 1, gain: 1, type: 'lowpass' }); this.voice(pos, 150, 110, 0.6, 'a', 0.6); this.creak(pos, 0.5, 0.5); break;
      case 'switch': this.noise({ dur: 0.025, f: 3500, q: 4, gain: 0.25, wet: 0 }); this.tone({ f: 2400, dur: 0.02, gain: 0.05, wet: 0 }); break;
      case 'escape': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ f, dur: 1.2, type: 'triangle', gain: 0.18, delay: i * 0.15, dest: this.musicBus })); break;
      case 'day': this.tone({ f: 110, to: 55, dur: 3, type: 'sawtooth', gain: 0.12, a: 0.3, dest: this.musicBus }); this.tone({ f: 164.8, to: 82, dur: 3, type: 'sawtooth', gain: 0.08, a: 0.3, dest: this.musicBus }); this.bell(0.3); break;
      case 'chat': this.tone({ f: 1200, dur: 0.06, gain: 0.07, wet: 0 }); break;
      case 'marker': this.tone({ f: 880, dur: 0.14, gain: 0.14, wet: 0.3 }); this.tone({ f: 1320, dur: 0.14, gain: 0.1, delay: 0.1, wet: 0.3 }); break;
      case 'carCrank': {
        const d = opt.dur || 4;
        for (let i = 0; i < Math.floor(d * 3.2); i++) { this.tone({ pos, f: 180, to: 120, dur: 0.22, type: 'sawtooth', gain: 0.18, delay: i * 0.31 }); this.noise({ pos, dur: 0.2, f: 600, q: 1, gain: 0.4, delay: i * 0.31, brown: true }); }
        this.engine(pos, d);
        break;
      }
      case 'carStall': this.tone({ pos, f: 90, to: 30, dur: 1.2, type: 'sawtooth', gain: 0.3 }); break;
      case 'crash': this.noise({ pos, dur: 1.2, f: 1500, q: 0.5, gain: 1.4, to: 300 }); this.play('metal', pos); this.play('glass', pos); this.tone({ pos, f: 50, to: 30, dur: 1, gain: 0.9 }); break;
    }
  }

  engine(pos, delay) {
    const c = this.ctx, t = c.currentTime + delay * 0.6;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(30, t); o.frequency.linearRampToValueAtTime(48, t + delay * 0.4 + 2);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.4); g.gain.linearRampToValueAtTime(0.0001, t + delay * 0.4 + 3);
    o.connect(lp).connect(g).connect(this.out(pos, 3));
    o.start(t); o.stop(t + delay * 0.4 + 3.2);
  }

  bell(delay = 0) {
    // колокол часов: несколько негармонических частот
    for (const [f, g] of [[220, 0.14], [440 * 1.19, 0.06], [220 * 2.76, 0.05], [220 * 5.4, 0.02]]) this.tone({ f, dur: 3.5, gain: g, delay, dest: this.musicBus, a: 0.005 });
  }

  // резкий аккорд-«стингер» при обнаружении
  stinger() {
    const c = this.ctx;
    for (const f of [55, 58.3, 82.4, 110, 116.5]) this.tone({ f, to: f * 1.06, dur: 1.6, type: 'sawtooth', gain: 0.07, a: 0.01, dest: this.musicBus });
    this.noise({ dur: 1.2, f: 3000, q: 0.3, gain: 0.25, a: 0.01, to: 800 });
    void c;
  }

  // ---------- фоновые звуки ----------
  startAmbience() {
    const c = this.ctx;
    // ветер: коричневый шум с порывами
    const w = c.createBufferSource(); w.buffer = this.brownBuf; w.loop = true;
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
    const wg = c.createGain(); wg.gain.value = 0.08;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.09; const lg = c.createGain(); lg.gain.value = 0.06; lfo.connect(lg).connect(wg.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.05; const lg2 = c.createGain(); lg2.gain.value = 250; lfo2.connect(lg2).connect(wf.frequency);
    w.connect(wf).connect(wg).connect(this.master);
    w.start(); lfo.start(); lfo2.start();
    this.windGain = wg;
    // случайные скрипы дома
    setInterval(() => {
      if (!this.listenerPos || document.hidden || this.mode !== 'game') return;
      if (Math.random() < 0.35) {
        const p = this.listenerPos;
        const pos = { x: p.x + rnd(-8, 8), y: p.y + rnd(-1, 2), z: p.z + rnd(-8, 8) };
        Math.random() < 0.6 ? this.creakTick(pos, rnd(0.2, 0.5)) : this.creak(pos, rnd(0.4, 0.9), rnd(0.12, 0.25), rnd(0.8, 1.4));
      }
    }, 3500);
  }

  // точечные источники: часы, камин, котёл
  addEmitter(type, pos) { this.emitters.push({ type, pos, t: Math.random() }); }
  clearEmitters() { this.emitters = []; }

  // ---------- музыка ----------
  setMusic(mode) {
    if (!this.ctx || this.mode === mode) return;
    this.mode = mode;
    this.musicStep = 0;
    clearInterval(this.musicTimer);
    const bpmMs = mode === 'chase' ? 150 : mode === 'lobby' ? 380 : 900;
    this.musicTimer = setInterval(() => this.musicTick(), bpmMs);
  }

  musicTick() {
    if (!this.ctx || document.hidden) return;
    const s = this.musicStep++;
    const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const bus = this.musicBus;
    if (this.mode === 'lobby') {
      // музыкальная шкатулка: колыбельная в миноре
      const mel = [69, 72, 76, 72, 74, 71, 67, 71, 69, 72, 76, 81, 80, 76, 71, 0, 69, 72, 76, 72, 74, 71, 67, 64, 65, 69, 72, 71, 68, 64, 69, 0];
      const n = mel[s % mel.length];
      if (n) { this.tone({ f: hz(n + 12), dur: 1.4, type: 'sine', gain: 0.06, a: 0.003, dest: bus }); this.tone({ f: hz(n + 24), dur: 0.5, type: 'sine', gain: 0.015, a: 0.003, dest: bus }); }
      if (s % 8 === 0) this.pad([45, 52, 57, 60].map(x => x + (s % 32 < 16 ? 0 : -2)), 3.2, 0.03);
    } else if (this.mode === 'game') {
      // тревожный эмбиент: медленные аккорды + редкие ноты шкатулки
      if (s % 6 === 0) { const chords = [[33, 40, 48], [31, 38, 46], [29, 36, 44], [32, 39, 47]]; this.pad(chords[(s / 6) % chords.length], 6, 0.035); }
      if (Math.random() < 0.18) this.tone({ f: hz([81, 84, 88, 86, 83][Math.floor(Math.random() * 5)]), dur: 2.5, type: 'sine', gain: 0.02, a: 0.003, dest: bus });
      if (Math.random() < 0.05) this.noise({ dur: 3, f: 200, q: 3, gain: 0.05, a: 1.5, to: 90, brown: true });
    } else if (this.mode === 'chase') {
      // погоня: пульсирующий бас, стаккато, удары
      const bass = [33, 33, 45, 33, 36, 33, 44, 33];
      this.tone({ f: hz(bass[s % 8]), dur: 0.14, type: 'sawtooth', gain: 0.12, a: 0.004, dest: bus });
      if (s % 4 === 0) { this.tone({ f: 60, to: 35, dur: 0.25, gain: 0.35, dest: bus }); this.noise({ dur: 0.12, f: 120, q: 1, gain: 0.3, type: 'lowpass', brown: true }); }
      if (s % 8 === 4) this.noise({ dur: 0.1, f: 2200, q: 0.7, gain: 0.22 });
      if (s % 2 === 1) this.tone({ f: hz([69, 70, 69, 72][Math.floor(s / 2) % 4] + 12), dur: 0.08, type: 'square', gain: 0.025, dest: bus });
      if (s % 16 === 0) for (const f of [hz(57), hz(58)]) this.tone({ f, dur: 2.2, type: 'sawtooth', gain: 0.03, a: 0.3, dest: bus });
    }
  }

  pad(notes, dur, gain) {
    const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    for (const n of notes) for (const d of [-7, 7]) this.tone({ f: hz(n), dur, type: 'sawtooth', gain: gain / notes.length, a: dur * 0.35, detune: d, dest: this.padFilter() });
  }

  padFilter() {
    if (this._pf) return this._pf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.5;
    const s = this.ctx.createGain(); s.gain.value = 0.6;
    f.connect(this.musicBus); f.connect(s); s.connect(this.reverb);
    return (this._pf = f);
  }

  setChase(on) {
    if (!this.ctx || on === this.chase) return;
    this.chase = on;
    this.setMusic(on ? 'chase' : 'game');
  }

  // сердцебиение и фоновые источники; вызывается каждый кадр
  update(dt, intensity, listener) {
    if (!this.ctx) return;
    if (intensity > 0.02) {
      this.hbTimer -= dt;
      if (this.hbTimer <= 0) {
        this.hbTimer = 1.15 - intensity * 0.72;
        const g = 0.15 + intensity * 0.5;
        this.tone({ f: 58, to: 34, dur: 0.14, gain: g, wet: 0 }); this.tone({ f: 52, to: 30, dur: 0.14, gain: g * 0.7, delay: 0.17, wet: 0 });
      }
    }
    for (const e of this.emitters) {
      e.t -= dt;
      if (e.t > 0) continue;
      if (listener && e.pos.distanceTo(listener) > 16) { e.t = 0.5; continue; }
      if (e.type === 'clock') { e.t = 1; this.noise({ pos: e.pos, dur: 0.03, f: 3500, q: 6, gain: 0.25, ref: 1 }); this.tone({ pos: e.pos, f: 1800, dur: 0.02, gain: 0.04, ref: 1 }); }
      else if (e.type === 'fire') { e.t = rnd(0.05, 0.4); this.noise({ pos: e.pos, dur: rnd(0.02, 0.06), f: rnd(1500, 5000), q: 2, gain: rnd(0.05, 0.25), ref: 1 }); if (Math.random() < 0.1) this.noise({ pos: e.pos, dur: 0.8, f: 300, q: 0.5, gain: 0.1, brown: true, a: 0.3, ref: 1 }); }
      else if (e.type === 'boiler') { e.t = 2; this.tone({ pos: e.pos, f: 55, dur: 2.2, type: 'sawtooth', gain: 0.05, a: 0.5, ref: 1.5 }); if (Math.random() < 0.2) this.noise({ pos: e.pos, dur: 0.6, f: 900, q: 5, gain: 0.08, ref: 1.5 }); }
      else if (e.type === 'hum') { e.t = 99; }
    }
  }

  // бабка напевает, когда бродит (жутко)
  hum(pos) {
    if (!this.ctx) return;
    const notes = [57, 60, 64, 60, 62, 59, 55, 59];
    notes.forEach((n, i) => {
      const f = 440 * Math.pow(2, (n - 12 - 69) / 12);
      setTimeout(() => this.voice(pos, f, f * 0.99, 0.55, 'u', 0.18), i * 520);
    });
  }
}
