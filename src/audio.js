// Audio 100 % procedural (Web Audio): sin archivos. Ambiente por capas que reacciona
// a la sala (reverberación según volumen, zumbido de fluorescentes, agua posicional),
// eventos lejanos esporádicos, pasos según superficie, brazadas, chapuzones y
// filtrado submarino.
export class AudioEngine {
  constructor() { this.ctx = null; this.t = 0; this.next = 3; this.nextFar = 25; this.under = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    const g = (v, to) => { const n = c.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(c.destination);
    this.master = g(0.0001, comp);
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.connect(this.master);
    this.dry = g(1, this.lp); this.send = g(1);
    this.revS = g(0.3, this.lp); this.revL = g(0.3, this.lp);
    const cs = c.createConvolver(); cs.buffer = this.ir(0.9, 2.6); this.send.connect(cs); cs.connect(this.revS);
    const cl = c.createConvolver(); cl.buffer = this.ir(5.2, 2.2); this.send.connect(cl); cl.connect(this.revL);
    // ruido base
    const nb = c.createBuffer(1, c.sampleRate * 3, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    const loop = (filterType, freq, q, gain, to) => {
      const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.6 + Math.random() * 0.5;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const gn = g(gain, to); s.connect(f); f.connect(gn); s.start();
      return { f, g: gn };
    };
    // aire de sala + zumbido grave de instalaciones
    this.air = loop('lowpass', 420, 0.3, 0.018, this.dry); this.air.g.connect(this.send);
    this.hum = g(0.012, this.dry);
    for (const fq of [54.6, 55.3, 109.4]) { const o = c.createOscillator(); o.frequency.value = fq; o.connect(this.hum); o.start(); }
    // agua posicional (chapoteo suave contra los bordes)
    this.wpan = this.panner(); this.wpan.connect(this.dry); this.wpan.connect(this.send);
    this.water = loop('bandpass', 850, 0.7, 0, this.wpan);
    this.water2 = loop('bandpass', 2400, 1.4, 0, this.wpan);
    // fluorescentes
    this.buzz = g(0, this.dry);
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2900; hp.Q.value = 0.8; hp.connect(this.buzz);
    for (const [type, fq] of [['sawtooth', 100], ['square', 200.4]]) { const o = c.createOscillator(); o.type = type; o.frequency.value = fq; o.connect(hp); o.start(); }
    const bl = g(0, this.dry); this.buzzLow = bl; const ob = c.createOscillator(); ob.frequency.value = 100; ob.connect(bl); ob.start();
    // colchón inquietante, casi imperceptible
    this.pad = g(0, this.send);
    const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 700; pf.connect(this.pad);
    for (const fq of [146.8, 174.1, 220.6, 261.1]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fq;
      const og = g(0.25, pf), l = c.createOscillator(), lg = g(0.2, og.gain);
      l.frequency.value = 0.03 + Math.random() * 0.07; l.connect(lg); l.start(); o.connect(og); o.start();
    }
    // rumor submarino
    this.rumble = loop('lowpass', 150, 0.5, 0, this.master);
    this.master.gain.setTargetAtTime(0.9, c.currentTime, 1.2);
  }

  suspend(on) { if (!this.ctx) return; this.master.gain.setTargetAtTime(on ? 0.0001 : 0.9, this.ctx.currentTime, 0.25); }

  ir(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / n; lp += ((Math.random() * 2 - 1) - lp) * (0.9 - 0.75 * t); d[i] = lp * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1); }
    }
    return b;
  }
  panner() {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = 80;
    return p;
  }
  setPos(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }

  // ráfaga de ruido filtrado con envolvente
  burst(o) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (o.delay || 0), s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.gain, t + (o.att || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f); f.connect(g); this.out(g, o);
    s.start(t, Math.random() * 2); s.stop(t + o.dur + 0.05);
  }
  tone(o) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (o.delay || 0), s = c.createOscillator(); s.type = o.wave || 'sine';
    s.frequency.setValueAtTime(o.f0, t); if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.gain, t + (o.att || 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(g); this.out(g, o);
    s.start(t); s.stop(t + o.dur + 0.05);
  }
  out(node, o) {
    let dst = node;
    if (o.pos) { const p = this.panner(); this.setPos(p, o.pos[0], o.pos[1], o.pos[2]); node.connect(p); dst = p; }
    dst.connect(this.dry);
    if (o.wet !== 0) { const w = this.ctx.createGain(); w.gain.value = o.wet ?? 0.6; dst.connect(w); w.connect(this.send); }
  }

  step(surf, wet = 0, power = 0.55) {
    if (!this.ctx) return;
    const v = power * (0.8 + Math.random() * 0.4), r = 0.9 + Math.random() * 0.25;
    if (surf === 'water') {
      this.burst({ f0: 500 * r, f1: 1500 * r, dur: 0.22 + wet * 0.12, gain: 0.16 * v + wet * 0.08, q: 0.8, att: 0.012, wet: 0.7 });
      this.burst({ f0: 2600 * r, f1: 900, dur: 0.16, gain: 0.05 * v, q: 1.5, delay: 0.05, wet: 0.7 });
      this.tone({ f0: 420 * r, f1: 900 * r, dur: 0.07, gain: 0.03 * wet, delay: 0.09 });
    } else if (surf === 'carpet') {
      this.burst({ type: 'lowpass', f0: 520 * r, dur: 0.09, gain: 0.2 * v, q: 0.5, wet: 0.15 });
      this.tone({ f0: 80, f1: 48, dur: 0.07, gain: 0.1 * v, wet: 0.1 });
    } else if (surf === 'concrete') {
      this.burst({ f0: 950 * r, dur: 0.06, gain: 0.2 * v, q: 0.7, wet: 0.8 });
      this.tone({ f0: 95, f1: 55, dur: 0.06, gain: 0.12 * v, wet: 0.5 });
    } else {
      this.burst({ f0: 1900 * r, dur: 0.05, gain: 0.17 * v, q: 1.1, wet: 0.9 });
      this.burst({ f0: 4200 * r, dur: 0.025, gain: 0.05 * v, q: 2, wet: 0.9 });
      this.tone({ f0: 105, f1: 60, dur: 0.055, gain: 0.11 * v, wet: 0.5 });
    }
  }
  stroke(under) {
    const r = 0.85 + Math.random() * 0.3;
    if (under) this.burst({ type: 'lowpass', f0: 380 * r, f1: 160, dur: 0.7, gain: 0.16, att: 0.18, wet: 0.2 });
    else { this.burst({ f0: 480 * r, f1: 1100 * r, dur: 0.55, gain: 0.11, q: 0.6, att: 0.16, wet: 0.7 }); this.burst({ f0: 2200, f1: 1200, dur: 0.3, gain: 0.03, q: 1.2, delay: 0.2, att: 0.05 }); }
  }
  splash(v) {
    this.burst({ type: 'lowpass', f0: 3200, f1: 420, dur: 0.9, gain: 0.4 * v, att: 0.01, wet: 0.9 });
    this.burst({ f0: 1300, f1: 2600, dur: 0.5, gain: 0.12 * v, q: 0.6, delay: 0.08, att: 0.05, wet: 0.9 });
    this.tone({ f0: 110, f1: 45, dur: 0.3, gain: 0.25 * v, wet: 0.3 });
  }
  click(on) { this.tone({ wave: 'square', f0: on ? 2400 : 1700, dur: 0.012, gain: 0.05, wet: 0.3 }); this.burst({ f0: 3500, dur: 0.02, gain: 0.06, q: 2, delay: 0.018, wet: 0.3 }); }
  submerge(under) {
    if (!this.ctx) return;
    this.under = under;
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(under ? 480 : 20000, t, under ? 0.05 : 0.12);
    this.rumble.g.gain.setTargetAtTime(under ? 0.22 : 0, t, 0.15);
    if (under) this.burst({ type: 'lowpass', f0: 900, f1: 200, dur: 0.6, gain: 0.25, att: 0.02, wet: 0 });
    else this.burst({ f0: 1200, f1: 3000, dur: 0.35, gain: 0.08, q: 0.7, att: 0.03 });
  }

  // eventos esporádicos alrededor del oyente
  event(cam, amb) {
    const a = Math.random() * 6.283, d = 4 + Math.random() * 14, pos = [cam.x + Math.cos(a) * d, cam.y + Math.random() * 3, cam.z + Math.sin(a) * d];
    if (amb.zone === 'pool' || amb.waterDist < 25) {
      const f = 900 + Math.random() * 1400;
      this.tone({ f0: f, f1: f * 0.55, dur: 0.11, gain: 0.07, pos, wet: 1 });
      if (Math.random() < 0.4) this.tone({ f0: f * 1.3, f1: f * 0.7, dur: 0.09, gain: 0.04, pos, wet: 1, delay: 0.14 + Math.random() * 0.2 });
    } else if (amb.zone === 'yellow') {
      this.burst({ f0: 3000 + Math.random() * 2000, dur: 0.05, gain: 0.03, q: 4, pos, wet: 0.2 });       // chisporroteo de tubo
    } else this.burst({ f0: 300 + Math.random() * 300, dur: 0.25, gain: 0.06, q: 3, pos, wet: 1 });       // tubería
  }
  farEvent(cam, amb) {
    const a = Math.random() * 6.283, pos = [cam.x + Math.cos(a) * 40, cam.y + (Math.random() - 0.5) * 16, cam.z + Math.sin(a) * 40];
    const k = Math.random();
    if (k < 0.4) { this.burst({ type: 'lowpass', f0: 140, f1: 60, dur: 2.2, gain: 1.2, att: 0.02, pos, wet: 1 }); }       // golpe sordo lejano
    else if (k < 0.7) { const f = 70 + Math.random() * 50; this.tone({ f0: f, f1: f * 0.8, dur: 4, gain: 0.9, att: 1.2, pos, wet: 1 }); }   // gemido de conductos
    else if (amb.zone === 'pool') { this.burst({ type: 'lowpass', f0: 2500, f1: 500, dur: 1.1, gain: 0.9, att: 0.02, pos, wet: 1 }); }       // chapuzón que no es tuyo
    else this.burst({ f0: 800, f1: 500, dur: 1.5, gain: 0.5, q: 6, att: 0.3, pos, wet: 1 });
  }

  update(dt, cam, fwd, amb) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, L = c.listener;
    if (L.positionX) {
      L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
    this.t += dt;
    // reverberación según el volumen y los materiales de la sala
    const big = Math.min(1, Math.log2(1 + amb.vol) / 6.2), absorb = amb.zone === 'yellow' ? 0.3 : 1;
    this.revL.gain.setTargetAtTime((0.06 + 0.75 * big * big) * absorb, t, 0.6);
    this.revS.gain.setTargetAtTime((0.5 - 0.3 * big) * absorb, t, 0.6);
    // agua: volumen por cercanía, con vaivén irregular
    const near = amb.waterDist < 60 ? 1 / (1 + amb.waterDist * 0.12) : 0;
    const lap = 0.55 + 0.3 * Math.sin(this.t * 0.7) + 0.15 * Math.sin(this.t * 1.9 + 1);
    this.water.g.gain.setTargetAtTime(near * 0.22 * lap, t, 0.3);
    this.water2.g.gain.setTargetAtTime(near * 0.05 * (1.2 - lap), t, 0.3);
    this.setPos(this.wpan, amb.water[0], amb.water[1], amb.water[2]);
    // fluorescentes y zumbidos
    const yl = amb.zone === 'yellow' ? 1 : 0, cc = amb.zone === 'concrete' ? 1 : 0;
    this.buzz.gain.setTargetAtTime(yl * 0.02 + (amb.zone === 'pool' && amb.mood === 'day' ? 0.0025 : 0), t, 0.8);
    this.buzzLow.gain.setTargetAtTime(yl * 0.02 + cc * 0.012, t, 0.8);
    this.hum.gain.setTargetAtTime(0.01 + cc * 0.02 + big * 0.008, t, 1);
    this.pad.gain.setTargetAtTime((amb.mood === 'night' ? 0.03 : 0.012) + cc * 0.02 + 0.008 * Math.sin(this.t * 0.05), t, 2);
    if (this.t > this.next) { this.next = this.t + 2 + Math.random() * (amb.zone === 'pool' ? 6 : 11); if (!this.under) this.event(cam, amb); }
    if (this.t > this.nextFar) { this.nextFar = this.t + 30 + Math.random() * 60; this.farEvent(cam, amb); }
  }
}
