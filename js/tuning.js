// Hidden tuning panel: muscle stiffness and rest length, soft-tissue settings, live measurements.
// Open it by tapping the "Hip VR" title three times (or add ?tune to the address).
// "Copy settings" puts the numbers on the clipboard so they can be sent back for permanent changes.
import { MUSCLES, defaultSettings } from './muscles.js';

const KEY = 'hipvr.tuning.v1';
const TISSUE_UI = [
  ['gravity', 'Gravity (×g)', 0, 2, 0.05],
  ['friction', 'Bone friction', 0, 1.2, 0.05],
  ['capsule', 'Hip capsule (N·mm/rad)', 0, 30000, 500],
  ['legRoll', 'Leg roll resistance (N·mm/rad)', 0, 10000, 100],
  ['tether', 'Soft-tissue envelope, sideways (N/mm)', 0, 40, 0.5],
  ['tetherAxial', 'Soft-tissue envelope, along shaft (N/mm)', 0, 5, 0.1],
  ['heelSupport', 'Heel support (N/mm)', 0, 80, 1],
  ['heelFriction', 'Heel friction', 0, 1, 0.05],
];

export class Tuning {
  constructor(app, sim) {
    this.app = app;
    this.sim = sim;
    this.el = document.getElementById('tune');
    this.body = document.getElementById('tune-body');
    document.getElementById('tune-close').onclick = () => this.toggle(false);
    this.load();
    this.build();
    if (/[?&]tune\b/.test(location.search)) this.toggle(true);
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) this.apply(saved);
    } catch (e) { /* storage unavailable */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.sim.settings)); } catch (e) { /* ignore */ }
  }

  apply(s) {
    const cur = this.sim.settings;
    for (const [id, v] of Object.entries(s.muscles || {})) if (cur.muscles[id]) Object.assign(cur.muscles[id], v);
    Object.assign(cur.tissue, s.tissue || {});
  }

  slider(parent, label, get, set, min, max, step, fmt = v => v) {
    const lab = document.createElement('label');
    lab.innerHTML = `<b style="font-weight:500">${label}</b><span></span>`;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = get();
    const out = lab.querySelector('span');
    out.textContent = fmt(get());
    inp.oninput = () => { set(Number(inp.value)); out.textContent = fmt(Number(inp.value)); this.save(); };
    lab.appendChild(inp);
    parent.appendChild(lab);
    this.inputs.push(() => { inp.value = get(); out.textContent = fmt(get()); });
  }

  build() {
    const s = this.sim.settings;
    this.body.innerHTML = '';
    this.inputs = [];
    const meas = document.createElement('pre');
    this.meas = meas;
    this.body.appendChild(meas);
    this.strainEls = {};
    for (const m of MUSCLES) {
      const h = document.createElement('h4');
      h.innerHTML = `${m.name} <span class="strain"></span>`;
      this.strainEls[m.id] = h.querySelector('.strain');
      this.body.appendChild(h);
      this.slider(this.body, 'Stiffness (N/mm)', () => s.muscles[m.id].k, v => { s.muscles[m.id].k = v; }, 0, 12, 0.1, v => v.toFixed(1));
      this.slider(this.body, 'Rest length (% of intact)', () => s.muscles[m.id].rest * 100, v => { s.muscles[m.id].rest = v / 100; }, 80, 105, 0.5, v => v.toFixed(1) + '%');
    }
    const h = document.createElement('h4');
    h.textContent = 'Soft tissue and support';
    this.body.appendChild(h);
    for (const [key, label, min, max, step] of TISSUE_UI) {
      this.slider(this.body, label, () => s.tissue[key], v => { s.tissue[key] = v; }, min, max, step, v => (step < 1 ? v.toFixed(2) : String(v)));
    }
    const btns = document.createElement('div');
    btns.className = 'btns';
    const mk = (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; btns.appendChild(b); };
    mk('Restart fracture', () => this.app.restartFracture());
    mk('Copy settings', () => this.copy());
    mk('Reset defaults', () => {
      const d = defaultSettings();
      this.apply(d);
      this.save();
      for (const f of this.inputs) f();
    });
    this.body.appendChild(btns);
    this.copied = document.createElement('div');
    this.copied.className = 'strain';
    this.body.appendChild(this.copied);
  }

  copy() {
    const text = JSON.stringify(this.sim.settings);
    const done = ok => { this.copied.textContent = ok ? 'Copied. Paste it into your message to Claude.' : text; };
    try {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } catch (e) { done(false); }
  }

  toggle(on) {
    this.el.hidden = on === undefined ? !this.el.hidden : !on;
  }

  /** called a few times per second */
  refresh(m) {
    if (this.el.hidden) return;
    this.meas.textContent =
      `Neck–shaft angle ${m.nsa.toFixed(1)}° (intact ${m.nsa0.toFixed(1)}°, varus ${m.varus.toFixed(1)}°)\n` +
      `Shortening ${m.shortening.toFixed(1)} mm   Rotation ${m.rotation.toFixed(1)}° (+ = external)\n` +
      `Posterior sag ${m.sag.toFixed(1)} mm   Anteromedial support: ${m.amcs}`;
    const by = {};
    for (const l of this.sim.lines) {
      const t = by[l.muscle] || (by[l.muscle] = []);
      t.push(`${l.tension.toFixed(0)} N, ${(l.strain * 100).toFixed(1)}%`);
    }
    for (const [id, el] of Object.entries(this.strainEls)) el.textContent = (by[id] || []).join(' | ');
  }
}
