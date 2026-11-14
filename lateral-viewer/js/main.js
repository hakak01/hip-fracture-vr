// Lateral C-arm viewer: 3D bone model and the matching C-arm image (DRR) side by side, both computed from the
// same CT and the same fragment positions.
import * as THREE from 'three';
import { loadAssets } from './assets.js';
import { DRR } from './drr.js';
import { View3D } from './view3d.js';
import { PRESETS, fractureFrame, measure, describe } from './presets.js';

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const state = {
  preset: Math.max(0, PRESETS.findIndex(p => p.id === q.get('preset'))),
  sev: q.has('sev') ? Number(q.get('sev')) : 0.5,
  view: q.get('view') === 'AP' ? 'AP' : 'LAT',
  tilt: q.has('tilt') ? Number(q.get('tilt')) : 0,
  colours: q.get('colours') === '1',
  see: q.get('see') || 'none',
  beam: q.get('beam') !== '0',
  invert: q.get('invert') === '1',
};

function progress(p) {
  $('loadbar').style.width = `${Math.round(p * 100)}%`;
}

async function main() {
  const { meta, gltf, volumes } = await loadAssets('assets/', progress);
  const canvas = $('c3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('test') });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const drr = new DRR(renderer, volumes, meta);
  drr.canvas.id = 'xr';
  for (const k of Object.keys(drr.params)) if (q.has(k)) drr.params[k] = Number(q.get(k)); // tuning
  if (q.has('gain')) drr.uniforms.uBoneGain.value = Number(q.get('gain'));
  $('vx').prepend(drr.canvas);
  const view = new View3D(renderer, canvas, gltf, meta);
  const f = fractureFrame(meta, name => view.vertices(name));
  const C = meta.carm;
  const UP = new THREE.Vector3(0, 1, 0);

  function geometry() {
    const iso = new THREE.Vector3().fromArray(C.iso);
    let d, V, U;
    if (state.view === 'AP') {
      d = new THREE.Vector3(0, 1, 0);          // source under the table, image intensifier above
      V = new THREE.Vector3(0, 0, -1);         // head up
      U = new THREE.Vector3().crossVectors(V, d); // patient's left on the right of the screen
    } else {
      d = new THREE.Vector3().fromArray(C.lateralDir).applyAxisAngle(UP, state.tilt * Math.PI / 180).normalize();
      V = UP.clone().addScaledVector(d, -UP.dot(d)).normalize(); // anterior up
      U = new THREE.Vector3().crossVectors(d, V);                // femoral head towards the same side as on the AP
    }
    const src = iso.clone().addScaledVector(d, -C.SOD);
    const det = iso.clone().addScaledVector(d, C.SID - C.SOD);
    return { src, det, dir: d, U: U.multiplyScalar(C.detR), V: V.multiplyScalar(C.detR) };
  }

  let dirty = true, shots = 0, lastGeom = null;
  function current() { return PRESETS[state.preset].build(f, state.sev); }

  function refresh() {
    const p = PRESETS[state.preset];
    const { P, D } = current();
    view.setFragments(P, D);
    const g = geometry();
    lastGeom = g;
    view.setBeam(g.src, g.dir, g.V.clone().normalize());
    view.setBeamVisible(state.beam);
    view.setColours(state.colours);
    view.setSeeThrough(state.see);
    $('pname').textContent = p.name;
    $('what').textContent = p.what;
    $('spot').textContent = p.spot;
    $('range').textContent = p.range ? `Mild → severe: ${p.range}` : '';
    $('sevrow').style.display = p.range ? '' : 'none';
    $('nums').innerHTML = describe(measure(f, P, D), f).map(s => `<li>${s}</li>`).join('');
    $('tiltrow').style.display = state.view === 'LAT' ? '' : 'none';
    $('tiltval').textContent = `${state.tilt > 0 ? '+' : ''}${state.tilt}°`;
    $('btnLat').classList.toggle('on', state.view === 'LAT');
    $('btnAP').classList.toggle('on', state.view === 'AP');
    $('btnCol').classList.toggle('on', state.colours);
    $('btnBeam').classList.toggle('on', state.beam);
    $('btnInv').classList.toggle('on', state.invert);
    drr.invert = state.invert;
    for (const k of ['none', 'prox', 'dist']) $(`see_${k}`).classList.toggle('on', state.see === k);
    dirty = true;
    $('busy').style.opacity = 1;
  }

  // ---------- controls ----------
  const sel = $('preset');
  PRESETS.forEach((p, i) => sel.add(new Option(p.name, i)));
  sel.value = state.preset;
  sel.onchange = () => { state.preset = Number(sel.value); refresh(); };
  const sev = $('sev');
  sev.value = Math.round(state.sev * 100);
  sev.oninput = () => { state.sev = sev.value / 100; refresh(); };
  const tilt = $('tilt');
  tilt.value = state.tilt;
  tilt.oninput = () => { state.tilt = Number(tilt.value); refresh(); };
  $('btnLat').onclick = () => { state.view = 'LAT'; refresh(); };
  $('btnAP').onclick = () => { state.view = 'AP'; refresh(); };
  $('btnCol').onclick = () => { state.colours = !state.colours; refresh(); };
  $('btnBeam').onclick = () => { state.beam = !state.beam; refresh(); };
  $('btnInv').onclick = () => { state.invert = !state.invert; refresh(); };
  for (const k of ['none', 'prox', 'dist']) $(`see_${k}`).onclick = () => { state.see = k; refresh(); };
  $('btnBeamView').onclick = () => view.beamView(lastGeom);
  $('btnFree').onclick = () => view.freeView();

  function resize() {
    const box = $('v3d').getBoundingClientRect();
    renderer.setSize(box.width, box.height, false);
    view.resize(box.width, box.height);
  }
  window.addEventListener('resize', resize);
  resize();

  drr.onImage = () => {
    shots++;
    window.__shots = shots;
    if (!drr.busy && !dirty) $('busy').style.opacity = 0;
  };
  refresh();
  if (q.get('cam') === 'beam') view.beamView(lastGeom);
  $('loading').remove();

  renderer.setAnimationLoop(() => {
    if (drr.busy) drr.tick();
    else if (dirty) {
      dirty = false;
      const { P, D } = current();
      const g = geometry();
      drr.shoot(g, P.clone().invert(), D.clone().invert(), {
        label: state.view === 'AP' ? 'AP' : 'LAT',
        sub: state.view === 'AP' ? '' : `TILT ${state.tilt > 0 ? '+' : ''}${state.tilt}°`,
      });
    }
    view.render();
  });

  // hooks for automated screenshots
  window.viewer = {
    set(s) { Object.assign(state, s); sel.value = state.preset; sev.value = Math.round(state.sev * 100); tilt.value = state.tilt; refresh(); },
    beamView() { view.beamView(lastGeom); },
    cam(pos, up) { view.setUp(new THREE.Vector3(...up)); view.camera.position.fromArray(pos); view.controls.target.copy(view.iso); view.camera.lookAt(view.iso); view.controls.update(); },
    get numbers() { return [...document.querySelectorAll('#nums li')].map(l => l.textContent); },
    freeView() { view.freeView(); },
    presets: PRESETS.map(p => p.id),
    get idle() { return !dirty && !drr.busy; },
  };
}

main().catch(e => {
  console.error(e);
  $('loading').innerHTML = `<p>Could not start: ${e.message}</p><p>This page needs WebGL 2 (a recent phone or computer browser).</p>`;
});
