// HTML controls for phone / laptop browsers.
import { SLIDERS, AUTO_CHOICES } from './reduce.js';
import { LIMITS } from './carm.js';

const CARM_SLIDERS = [
  { id: 'orbit', label: 'Orbit (AP → lateral)', unit: '°' },
  { id: 'tilt', label: 'Tilt', unit: '°' },
  { id: 'wig', label: 'Wig-wag', unit: '°' },
  { id: 'up', label: 'Down / up', unit: 'mm' },
  { id: 'head', label: 'Foot / head', unit: 'mm' },
  { id: 'med', label: 'Out / in', unit: 'mm' },
];
const GUIDE_SLIDERS = [
  { id: 'h', label: 'Height on shaft (+ = distal)', unit: 'mm', min: -30, max: 40 },
  { id: 'rot', label: 'Anteversion (rotate guide)', unit: '°', min: -20, max: 55 },
  { id: 'ap', label: 'Anterior / posterior shift', unit: 'mm', min: -10, max: 10 },
];

const $ = id => document.getElementById(id);

export class HUD {
  constructor(app) {
    this.app = app;
    $('btn-ap').onclick = () => app.shoot('AP');
    $('btn-lat').onclick = () => app.shoot('LAT');
    $('btn-obl').onclick = () => app.shoot('OBL');
    $('btn-xray').onclick = () => app.shoot();
    $('btn-laser').onclick = () => app.toggleLaser();
    $('btn-guide').onclick = () => app.placeGuide();
    $('btn-unguide').onclick = () => app.removeGuide();
    $('btn-unwire').onclick = () => app.removeWire();
    $('btn-score').onclick = () => app.score();
    // press-and-hold drilling buttons
    for (const [id, dir] of [['btn-drill', 1], ['btn-back', -1]]) {
      const b = $(id);
      const on = e => { e.preventDefault(); app.setDrill(dir); };
      const off = () => app.setDrill(0);
      b.addEventListener('pointerdown', on);
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off);
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
    this.carm = this.rangeGroup($('carm-sliders'), CARM_SLIDERS.map(c => ({ ...c, min: LIMITS[c.id][0], max: LIMITS[c.id][1] })),
      (id, v) => app.setCarm(id, v));
    this.guideSl = this.rangeGroup($('guide-sliders'), GUIDE_SLIDERS, (id, v) => app.setGuide(id, v));
    $('btn-invert').onclick = () => app.toggleInvert();
    $('btn-skin').onclick = () => app.setSkinOn(!app.state.skinOn);
    $('skin-fade').oninput = e => app.setSkinOpacity(e.target.value / 100);
    $('btn-muscles').onclick = () => app.setMuscles(!app.state.muscles);
    $('btn-right').onclick = () => app.setSide('right');
    $('btn-left').onclick = () => app.setSide('left');
    $('btn-view').onclick = () => app.resetView();
    $('btn-vr').onclick = () => app.enterVR();
    $('btn-about').onclick = () => { $('about').hidden = false; };
    $('btn-about-close').onclick = () => { $('about').hidden = true; };
    $('pip').onclick = () => $('pip').classList.toggle('big');
    $('btn-release').onclick = () => app.releaseAll();
    $('btn-restart').onclick = () => app.restartFracture();
    this.pip = { AP: $('pip-AP'), LAT: $('pip-LAT') };

    for (const t of document.querySelectorAll('#toolbar .tab')) {
      t.onclick = () => this.showTab(t.dataset.tab);
    }

    // reduction sliders
    const box = $('sliders');
    let group = '';
    this.sliders = {};
    for (const s of SLIDERS) {
      if (s.group !== group) {
        group = s.group;
        const g = document.createElement('div');
        g.className = 'grp';
        g.textContent = group;
        box.appendChild(g);
      }
      const lab = document.createElement('label');
      lab.innerHTML = `<span>${s.label}</span><span class="v"></span>`;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = s.min; inp.max = s.max; inp.step = 1; inp.value = 0;
      inp.oninput = () => { app.setSlider(s.id, Number(inp.value)); this.sliderText(s); };
      lab.appendChild(inp);
      box.appendChild(lab);
      this.sliders[s.id] = { input: inp, value: lab.querySelector('.v'), def: s };
      this.sliderText(s);
    }
    // auto-reduce choices
    const ab = $('auto-buttons');
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'Auto-reduce:';
    ab.appendChild(lbl);
    for (const c of AUTO_CHOICES) {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.className = c.id === 'good' ? 'big' : '';
      b.onclick = () => app.autoReduce(c.id);
      ab.appendChild(b);
    }
    // hidden tuning panel: tap the title three times
    let taps = [];
    $('title').addEventListener('click', e => {
      if (e.target.id === 'btn-about') return;
      const now = performance.now();
      taps = taps.filter(t => now - t < 800);
      taps.push(now);
      if (taps.length >= 3) { taps = []; app.toggleTuning(); }
    });
  }

  /** a group of labelled range sliders; returns {id: {input, value, def}} */
  rangeGroup(box, defs, onInput) {
    const out = {};
    for (const d of defs) {
      const lab = document.createElement('label');
      lab.innerHTML = `<span>${d.label}</span><span class="v"></span>`;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = 1; inp.value = 0;
      const val = lab.querySelector('.v');
      inp.oninput = () => { onInput(d.id, Number(inp.value)); val.textContent = `${inp.value} ${d.unit}`; };
      lab.appendChild(inp);
      box.appendChild(lab);
      val.textContent = `0 ${d.unit}`;
      out[d.id] = { input: inp, value: val, def: d };
    }
    return out;
  }

  setGroup(group, values) {
    for (const [id, sl] of Object.entries(group)) {
      if (!(id in values) || document.activeElement === sl.input) continue;
      const v = Math.round(values[id]);
      if (Number(sl.input.value) !== v) sl.input.value = v;
      sl.value.textContent = `${v} ${sl.def.unit}`;
    }
  }

  carmChanged(state, text) {
    this.setGroup(this.carm, state);
    $('carm-readout').textContent = text;
  }

  guideChanged(g) { this.setGroup(this.guideSl, g); }

  wireStatus(text) { $('wire-status').textContent = text; }

  showScore(lines) {
    const box = $('score-box');
    box.hidden = false;
    box.innerHTML = lines.map((l, i) => (i === 0 ? `<b>${l}</b>` : l)).join('<br>');
  }

  hideScore() { $('score-box').hidden = true; }

  toast(text, ms = 2500) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.hidden = true; }, ms);
  }

  showTab(name) {
    for (const t of document.querySelectorAll('#toolbar .tab')) t.classList.toggle('on', t.dataset.tab === name);
    for (const p of document.querySelectorAll('#toolbar .pane')) p.hidden = p.dataset.pane !== name;
  }

  sliderText(s) {
    const sl = this.sliders[s.id];
    sl.value.textContent = `${sl.input.value} ${s.unit}`;
  }

  resetSliders() {
    for (const sl of Object.values(this.sliders)) { sl.input.value = 0; this.sliderText(sl.def); }
  }

  showVRButton(show) { $('btn-vr').hidden = !show; }

  setProgress(p, text) {
    $('load-bar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('load-text').textContent = text;
  }

  hideLoading() { $('loading').style.display = 'none'; }

  showError(msg) {
    $('loading').style.display = 'flex';
    $('load-text').textContent = msg;
    $('load-bar').style.background = '#c8453a';
  }

  setCase(name) { $('about-case').textContent = name; }

  showImage(view, canvas, live) {
    const c = this.pip[view];
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    for (const v of Object.keys(this.pip)) this.pip[v].parentElement.classList.toggle('live', v === live);
  }

  readout(text) {
    $('readout-r').textContent = text;
    $('readout-a').textContent = text;
  }

  refresh() {
    const s = this.app.state;
    $('btn-skin').textContent = s.skinOn ? 'On' : 'Off';
    $('btn-skin').classList.toggle('on', s.skinOn);
    $('skin-fade').value = Math.round(s.skinOpacity * 100);
    $('btn-muscles').textContent = s.muscles ? 'On' : 'Off';
    $('btn-muscles').classList.toggle('on', s.muscles);
    $('btn-right').classList.toggle('on', s.side === 'right');
    $('btn-left').classList.toggle('on', s.side === 'left');
    $('btn-invert').classList.toggle('on', s.invert);
    for (const v of ['ap', 'lat', 'obl']) $('btn-' + v).classList.toggle('on', s.busy === v.toUpperCase());
    $('btn-xray').classList.toggle('on', s.busy === 'HERE');
    $('btn-laser').classList.toggle('on', s.laser);
    $('side-label').textContent = s.side === 'right' ? 'Right hip' : 'Left hip';
  }

  setVisible(v) {
    for (const id of ['title', 'pip', 'toolbar']) $(id).style.display = v ? '' : 'none';
    if (!v) $('tune').hidden = true;
  }
}
