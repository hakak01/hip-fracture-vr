// HTML controls for phone / laptop browsers.
const $ = id => document.getElementById(id);

export class HUD {
  constructor(app) {
    this.app = app;
    $('btn-ap').onclick = () => app.shoot('AP');
    $('btn-lat').onclick = () => app.shoot('LAT');
    $('btn-invert').onclick = () => app.toggleInvert();
    $('btn-skin').onclick = () => app.setSkinOn(!app.state.skinOn);
    $('skin-fade').oninput = e => app.setSkinOpacity(e.target.value / 100);
    $('btn-right').onclick = () => app.setSide('right');
    $('btn-left').onclick = () => app.setSide('left');
    $('btn-view').onclick = () => app.resetView();
    $('btn-vr').onclick = () => app.enterVR();
    $('btn-about').onclick = () => { $('about').hidden = false; };
    $('btn-about-close').onclick = () => { $('about').hidden = true; };
    $('pip').onclick = () => $('pip').classList.toggle('big');
    this.pip = { AP: $('pip-ap'), LAT: $('pip-lat') };
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
    for (const v of ['AP', 'LAT']) this.pip[v].parentElement.classList.toggle('live', v === live);
  }

  refresh() {
    const s = this.app.state;
    $('btn-skin').textContent = s.skinOn ? 'On' : 'Off';
    $('btn-skin').classList.toggle('on', s.skinOn);
    $('skin-fade').value = Math.round(s.skinOpacity * 100);
    $('btn-right').classList.toggle('on', s.side === 'right');
    $('btn-left').classList.toggle('on', s.side === 'left');
    $('btn-invert').classList.toggle('on', s.invert);
    $('btn-ap').classList.toggle('on', s.busy === 'AP');
    $('btn-lat').classList.toggle('on', s.busy === 'LAT');
    $('side-label').textContent = s.side === 'right' ? 'Right hip' : 'Left hip';
  }

  setVisible(v) {
    for (const id of ['title', 'pip', 'toolbar']) $(id).style.display = v ? '' : 'none';
  }
}
