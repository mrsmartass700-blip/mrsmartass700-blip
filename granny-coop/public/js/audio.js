// Все звуки синтезируются WebAudio — без аудиофайлов. Позиционный звук через PannerNode (HRTF).
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.hbTimer = 0;
    this.hbIntensity = 0;
    this.chase = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // буфер шума
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
    this.startChaseDrone();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    const f = { x: -Math.sin(cam.rotation.y), z: -Math.cos(cam.rotation.y) };
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, 0, f.z, 0, 1, 0);
    }
  }

  out(pos, refDist = 1.5) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = 60;
    p.rolloffFactor = 1.3;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1.2; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y ?? 1.2, pos.z);
    p.connect(this.master);
    return p;
  }

  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  noiseBurst({ pos, dur = 0.2, freq = 1000, q = 1, type = 'bandpass', gain = 0.5, attack = 0.005, sweepTo = null, ref }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, attack, gain, dur);
    src.connect(f).connect(g).connect(this.out(pos, ref));
    src.start(t, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
  }

  tone({ pos, freq = 200, to = null, dur = 0.3, type = 'sine', gain = 0.3, attack = 0.01, delay = 0, ref }) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, attack, gain, dur);
    o.connect(g).connect(this.out(pos, ref));
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, pos = null) {
    if (!this.ctx) return;
    const r = Math.random;
    switch (name) {
      case 'step': this.noiseBurst({ pos, dur: 0.09, freq: 300 + r() * 200, q: 0.8, gain: 0.25, type: 'lowpass' }); break;
      case 'stepRun': this.noiseBurst({ pos, dur: 0.1, freq: 500 + r() * 200, q: 0.8, gain: 0.4, type: 'lowpass' }); break;
      case 'grannyStep':
        this.noiseBurst({ pos, dur: 0.16, freq: 180 + r() * 60, q: 1.2, gain: 0.9, type: 'lowpass', ref: 2.5 });
        this.tone({ pos, freq: 70, to: 45, dur: 0.12, gain: 0.35, ref: 2.5 });
        break;
      case 'door':
        this.tone({ pos, freq: 420 + r() * 120, to: 260, dur: 0.7, type: 'sawtooth', gain: 0.05, attack: 0.08 });
        this.noiseBurst({ pos, dur: 0.6, freq: 1800, q: 12, gain: 0.25, sweepTo: 900, attack: 0.05 });
        break;
      case 'doorClose':
        this.noiseBurst({ pos, dur: 0.18, freq: 200, q: 1, gain: 0.8, type: 'lowpass' });
        this.tone({ pos, freq: 90, to: 50, dur: 0.15, gain: 0.4 });
        break;
      case 'creak':
        this.tone({ pos, freq: 180 + r() * 80, to: 120 + r() * 40, dur: 0.45, type: 'sawtooth', gain: 0.12, attack: 0.05 });
        this.noiseBurst({ pos, dur: 0.4, freq: 700, q: 15, gain: 0.3, sweepTo: 400 });
        break;
      case 'pickup': this.tone({ pos, freq: 900, to: 1400, dur: 0.08, type: 'triangle', gain: 0.2 }); break;
      case 'drop': case 'thud':
        this.noiseBurst({ pos, dur: 0.15, freq: 400, q: 1, gain: name === 'thud' ? 0.9 : 0.5, type: 'lowpass' });
        this.tone({ pos, freq: 120, to: 70, dur: 0.12, gain: 0.3 });
        break;
      case 'glass':
        for (let i = 0; i < 6; i++) this.tone({ pos, freq: 2500 + r() * 3000, dur: 0.15 + r() * 0.3, type: 'triangle', gain: 0.12, delay: r() * 0.12 });
        this.noiseBurst({ pos, dur: 0.35, freq: 5000, q: 0.7, gain: 0.7, type: 'highpass' });
        break;
      case 'trap':
        this.noiseBurst({ pos, dur: 0.12, freq: 3000, q: 2, gain: 1.0 });
        this.tone({ pos, freq: 1200, to: 300, dur: 0.25, type: 'square', gain: 0.2 });
        this.tone({ pos, freq: 80, to: 40, dur: 0.3, gain: 0.6 });
        break;
      case 'locked':
        this.noiseBurst({ pos, dur: 0.07, freq: 2500, q: 5, gain: 0.35 });
        this.noiseBurst({ pos, dur: 0.07, freq: 2200, q: 5, gain: 0.35, attack: 0.09 });
        break;
      case 'unlock':
        this.tone({ pos, freq: 1500, to: 900, dur: 0.1, type: 'square', gain: 0.08 });
        this.noiseBurst({ pos, dur: 0.15, freq: 3000, q: 4, gain: 0.4 });
        break;
      case 'boards':
        for (let i = 0; i < 4; i++) { this.tone({ pos, freq: 140, to: 60, dur: 0.12, gain: 0.7, delay: i * 0.22 }); }
        this.noiseBurst({ pos, dur: 0.8, freq: 600, q: 1, gain: 0.6, sweepTo: 200 });
        break;
      case 'chain':
        for (let i = 0; i < 5; i++) this.tone({ pos, freq: 3000 + r() * 1500, dur: 0.1, type: 'triangle', gain: 0.1, delay: i * 0.06 });
        this.noiseBurst({ pos, dur: 0.1, freq: 4000, q: 3, gain: 0.6, attack: 0.3 });
        break;
      case 'spray': this.noiseBurst({ pos, dur: 0.7, freq: 6000, q: 0.5, gain: 0.5, type: 'highpass', attack: 0.02 }); break;
      case 'swing': this.noiseBurst({ pos, dur: 0.35, freq: 300, q: 2, gain: 0.7, sweepTo: 1600, attack: 0.25 }); break;
      case 'hit':
        this.tone({ freq: 90, to: 30, dur: 0.6, gain: 1.0, type: 'sine' });
        this.noiseBurst({ dur: 0.35, freq: 500, q: 0.7, gain: 1.0, type: 'lowpass' });
        break;
      case 'spotted':
        // резкий «стингер» + её «Хм!»
        this.tone({ freq: 55, to: 110, dur: 1.2, type: 'sawtooth', gain: 0.25, attack: 0.01 });
        this.tone({ freq: 58, to: 116, dur: 1.2, type: 'sawtooth', gain: 0.25, attack: 0.01 });
        this.voice(pos, 220, 150, 0.35);
        break;
      case 'hear': this.voice(pos, 200, 240, 0.3); break;
      case 'angry': this.voice(pos, 160, 90, 0.8); this.voice(pos, 175, 95, 0.8); break;
      case 'stun': this.voice(pos, 300, 500, 0.6); this.voice(pos, 500, 200, 0.5); break;
      case 'switch': this.noiseBurst({ dur: 0.03, freq: 3000, q: 4, gain: 0.25 }); break;
      case 'pull': this.noiseBurst({ pos, dur: 0.5, freq: 250, q: 1, gain: 1, type: 'lowpass' }); this.voice(pos, 150, 110, 0.5); break;
      case 'escape':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.6, type: 'triangle', gain: 0.2, delay: i * 0.18 }));
        break;
      case 'day':
        this.tone({ freq: 110, to: 55, dur: 2.5, type: 'sawtooth', gain: 0.15, attack: 0.2 });
        this.tone({ freq: 164, to: 82, dur: 2.5, type: 'sawtooth', gain: 0.1, attack: 0.2 });
        break;
      case 'chat': this.tone({ freq: 1200, dur: 0.06, type: 'sine', gain: 0.08 }); break;
      case 'marker': this.tone({ freq: 880, dur: 0.12, type: 'sine', gain: 0.15 }); this.tone({ freq: 1320, dur: 0.12, type: 'sine', gain: 0.12, delay: 0.1 }); break;
    }
  }

  // «голос» бабки: пила через два формантных фильтра
  voice(pos, f0, f1, dur) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const out = this.ctx.createGain();
    this.env(out, t, 0.04, 0.35, dur);
    for (const [ff, q] of [[700, 6], [1150, 8]]) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
      o.connect(bp).connect(out);
    }
    out.connect(this.out(pos, 2.5));
    o.start(t); o.stop(t + dur + 0.05);
  }

  startAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = this.ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    // низкий гул дома
    const hum = this.ctx.createOscillator(); hum.frequency.value = 48; hum.type = 'sine';
    const hg = this.ctx.createGain(); hg.gain.value = 0.02;
    hum.connect(hg).connect(this.master); hum.start();
  }

  startChaseDrone() {
    this.chaseGain = this.ctx.createGain();
    this.chaseGain.gain.value = 0;
    this.chaseGain.connect(this.master);
    for (const f of [41.2, 43.6, 82.4]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      o.connect(lp).connect(this.chaseGain); o.start();
    }
  }

  setChase(on) {
    if (!this.ctx || on === this.chase) return;
    this.chase = on;
    this.chaseGain.gain.setTargetAtTime(on ? 0.18 : 0, this.ctx.currentTime, on ? 0.3 : 1.5);
  }

  // сердцебиение: intensity 0..1
  update(dt, intensity) {
    if (!this.ctx) return;
    this.hbIntensity = intensity;
    if (intensity <= 0.02) return;
    this.hbTimer -= dt;
    if (this.hbTimer <= 0) {
      this.hbTimer = 1.2 - intensity * 0.75;
      const g = 0.15 + intensity * 0.5;
      this.tone({ freq: 60, to: 35, dur: 0.12, gain: g });
      this.tone({ freq: 55, to: 32, dur: 0.12, gain: g * 0.7, delay: 0.16 });
    }
  }
}
