// Simple synthesised sounds (no sound files): C-arm exposure beep, power drill, warning tone.
export class Sounds {
  constructor() {
    this.ctx = null;
    this.drillNodes = null;
    this.enabled = true;
  }

  /** must be called from a user gesture (tap, click, entering VR) */
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  }

  tone(freq, dur, vol = 0.12, type = 'sine', when = 0) {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** X-ray exposure: the C-arm beeps while the beam is on */
  beep() { this.tone(1046, 0.42, 0.1); }

  warn() { this.tone(660, 0.18, 0.14, 'square'); this.tone(440, 0.25, 0.14, 'square', 0.2); }

  click() { this.tone(1800, 0.03, 0.05, 'square'); }

  /** power drill: on/off, load 0 (free) .. 1 (hard cortical bone) */
  drill(on, load = 0) {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    if (on && !this.drillNodes) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square';
      f.type = 'lowpass'; f.frequency.value = 1800;
      g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g).connect(c.destination);
      o.start(); o2.start();
      this.drillNodes = { o, o2, g, f };
    }
    const n = this.drillNodes;
    if (!n) return;
    const t = c.currentTime;
    if (on) {
      const rpm = 1 - 0.45 * load;
      n.o.frequency.setTargetAtTime(210 * rpm, t, 0.05);
      n.o2.frequency.setTargetAtTime(420 * rpm + 3, t, 0.05);
      n.f.frequency.setTargetAtTime(1200 + 1600 * rpm, t, 0.05);
      n.g.gain.setTargetAtTime(0.05 + 0.03 * load, t, 0.03);
    } else {
      n.g.gain.setTargetAtTime(0, t, 0.04);
      const nodes = n;
      this.drillNodes = null;
      setTimeout(() => { try { nodes.o.stop(); nodes.o2.stop(); } catch (e) { /* already stopped */ } }, 300);
    }
  }
}
