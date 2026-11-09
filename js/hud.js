// HTML controls for phone / laptop browsers.
import { SLIDERS, AUTO_CHOICES } from './reduce.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor(app) {
    this.app = app;
    $('btn-ap').onclick = () => app.shoot('AP');
    $('btn-lat').onclick = () => app.shoot('LAT');
    $('btn-obl').onclick = () => app.shoot('OBL');
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
    this.pip = { AP: $('pip-AP'), LAT: $('pip-LAT'), OBL: $('pip-OBL') };

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
    $('side-label').textContent = s.side === 'right' ? 'Right hip' : 'Left hip';
  }

  setVisible(v) {
    for (const id of ['title', 'pip', 'toolbar']) $(id).style.display = v ? '' : 'none';
    if (!v) $('tune').hidden = true;
  }
}
