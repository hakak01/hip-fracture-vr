// Hip Fracture VR Trainer — milestone 2: fracture, muscle springs, reduction controls, Auto-reduce.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadAssets } from './assets.js';
import { buildRoom, buildSideFurniture, TABLE_TOP } from './room.js';
import { Patient } from './patient.js';
import { CArm } from './carm.js';
import { DRR } from './drr.js';
import { Monitor } from './monitor.js';
import { Panel } from './panel.js';
import { XRSystem, vrSupported } from './xr.js';
import { HUD } from './hud.js';
import { FractureSim } from './physics.js';
import { FractureView } from './fracture.js';
import { Reducer } from './reduce.js';
import { Tools } from './tools.js';
import { Tuning } from './tuning.js';

const ASSETS = 'assets/ct/';

const app = {
  state: { side: 'right', skinOn: true, skinOpacity: 1, invert: false, busy: null, live: null, inVR: false, muscles: true },
};
const hud = new HUD(app);

// ---------- renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
if (!renderer.capabilities.isWebGL2) {
  hud.showError('This browser does not support WebGL 2. Please use Chrome, Safari or the Quest browser.');
  throw new Error('WebGL2 required');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1a20);
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.02, 40);
rig.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 0.25;
controls.maxDistance = 5;
controls.maxPolarAngle = Math.PI * 0.92;

const room = buildRoom(scene);
const sideFurniture = buildSideFurniture();
scene.add(sideFurniture);

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let patient, carm, drr, monitor, controlPanel, reductionPanel, xr, sim, fracView, reducer, tools, tuning;
let shootAfterSettle = 0; // seconds of settling left before automatic AP/LAT shots
const sideSign = () => (app.state.side === 'right' ? 1 : -1);

// ---------- app actions (shared by the HTML bar and the VR panels) ----------
const queue = [];
app.shoot = view => {
  if (!drr) return;
  if (app.state.busy) { if (!queue.includes(view)) queue.push(view); return; }
  app.state.busy = view;
  refresh();
  carm.moveTo(view, () => {
    carm.beam.visible = true;
    sim.matrixP(drr.fragments[0].matrix);
    sim.matrixD(drr.fragments[1].matrix);
    drr.shoot(view, projectionLocal(view));
  });
};

function projectionLocal(view) {
  const p = carm.projection(view);
  const src = patient.toLocal(p.src);
  const det = patient.toLocal(p.det);
  const U = patient.toLocal(p.det.clone().addScaledVector(p.u, p.radius)).sub(det);
  const V = patient.toLocal(p.det.clone().addScaledVector(p.v, p.radius)).sub(det);
  return { src, det, U, V };
}

function imageDone(view) {
  carm.beam.visible = false;
  app.state.busy = null;
  app.state.live = view;
  monitor.imageUpdated(view);
  hud.showImage(view, drr.canvases[view], view);
  refresh();
  if (queue.length) app.shoot(queue.shift());
}

app.toggleInvert = () => {
  app.state.invert = !app.state.invert;
  drr.invert = app.state.invert;
  drr.reprocess();
  for (const v of ['AP', 'LAT', 'OBL']) {
    monitor.screens[v].tex.needsUpdate = true;
    hud.showImage(v, drr.canvases[v], app.state.live);
  }
  refresh();
};

app.setSkinOn = on => {
  app.state.skinOn = on;
  if (on && app.state.skinOpacity < 0.05) app.state.skinOpacity = 1;
  patient.setSkin(app.state.skinOn, app.state.skinOpacity);
  refresh();
};

app.setSkinOpacity = v => {
  app.state.skinOpacity = v;
  app.state.skinOn = v > 0.02;
  patient.setSkin(app.state.skinOn, v);
  refresh();
};

app.setSide = side => {
  if (side === app.state.side && patient.side === side) return;
  app.state.side = side;
  applySide();
  refresh();
};

function applySide() {
  const s = sideSign();
  patient.setSide(app.state.side);
  sideFurniture.scale.x = s;
  sideFurniture.userData.cradle.position.copy(patient.wellCalfWorld());
  sideFurniture.userData.cradle.position.x *= s; // undo the group mirror for this world position
  sideFurniture.userData.cradle.position.y -= 0.075;
  carm.configure(patient);
  monitor.place(s);
  drr.sideLetter = app.state.side === 'right' ? 'R' : 'L';
  // VR: stand lateral to the operated hip, facing the patient
  xr.setHome(new THREE.Vector3(-0.7 * s, 0, 0.1), s > 0 ? -Math.PI / 2 : Math.PI / 2);
  if (renderer.xr.isPresenting) xr.goHome();
  for (const [panel, z] of [[controlPanel, 0.85], [reductionPanel, -0.62]]) {
    panel.mesh.position.set(-0.95 * s, 1.15, z);
    panel.mesh.lookAt(-0.6 * s, 1.75, 0.08);
  }
  tools.place(s);
  queue.length = 0;
  shootAll();
  if (!renderer.xr.isPresenting) app.resetView();
}

function shootAll() {
  app.shoot('OBL');
  app.shoot('LAT');
  app.shoot('AP');
}

app.setMuscles = on => {
  app.state.muscles = on;
  fracView.setMusclesVisible(on);
  refresh();
};

app.setSlider = (id, v) => reducer.setSlider(id, v);

app.releaseAll = () => {
  reducer.releaseAll();
  hud.resetSliders();
  refresh();
};

app.freeLeg = () => { sim.releaseFoot(); reducer.ref = null; refresh(); };
app.freePin = () => { sim.releasePin(); reducer.ref = null; refresh(); };

app.autoReduce = kind => {
  hud.resetSliders();
  reducer.autoReduce(kind);
  app.state.autoKind = kind;
  refresh();
};

app.restartFracture = () => {
  reducer.releaseAll();
  hud.resetSliders();
  sim.reset();
  shootAfterSettle = 5;
  refresh();
};

app.toggleTuning = () => tuning.toggle();

app.resetView = () => {
  const s = sideSign();
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  const portrait = window.innerWidth < window.innerHeight;
  camera.fov = portrait ? 68 : 55;
  camera.updateProjectionMatrix();
  const k = portrait ? 1.45 : 1;
  camera.position.set(-1.45 * s * k, 1.75 + (k - 1) * 0.4, -0.75 * k);
  controls.target.set(0.15 * s, TABLE_TOP + 0.2, 0.3);
  controls.update();
};

app.enterVR = () => xr.enter().catch(err => alert('Could not start VR: ' + err.message));
app.exitVR = () => xr.exit();

function refresh() {
  hud.refresh();
  if (controlPanel) controlPanel.draw();
  if (reductionPanel) reductionPanel.draw();
  if (monitor) monitor.panel.draw();
}

function readoutText(m) {
  const status = reducer.status ? ` · ${reducer.status}` : '';
  return `Neck–shaft ${m.nsa.toFixed(0)}° (varus ${m.varus.toFixed(0)}°) · shortening ${m.shortening.toFixed(0)} mm · ` +
    `rotation ${m.rotation >= 0 ? 'ext' : 'int'} ${Math.abs(m.rotation).toFixed(0)}° · sag ${m.sag.toFixed(0)} mm · AM support: ${m.amcs}${status}`;
}

// ---------- VR control panel ----------
function makeControlPanel() {
  return new Panel({
    width: 0.56, height: 0.4, title: 'Controls',
    items: [
      { type: 'label', x: 22, y: 52, w: 200, h: 24, label: 'C-arm', size: 22, color: '#9fb3ba' },
      { type: 'button', x: 20, y: 78, w: 110, h: 66, label: 'AP', onPress: () => app.shoot('AP'), active: () => app.state.busy === 'AP' },
      { type: 'button', x: 140, y: 78, w: 120, h: 66, label: 'LAT', onPress: () => app.shoot('LAT'), active: () => app.state.busy === 'LAT' },
      { type: 'button', x: 270, y: 78, w: 150, h: 66, label: 'OBL 30°', size: 28, onPress: () => app.shoot('OBL'), active: () => app.state.busy === 'OBL' },
      { type: 'button', x: 430, y: 78, w: 110, h: 66, label: 'Invert', size: 26, onPress: () => app.toggleInvert(), active: () => app.state.invert },
      { type: 'label', x: 22, y: 152, w: 200, h: 24, label: 'Skin', size: 22, color: '#9fb3ba' },
      { type: 'button', x: 20, y: 178, w: 160, h: 62, label: () => (app.state.skinOn ? 'Skin ON' : 'Skin OFF'), size: 28, onPress: () => app.setSkinOn(!app.state.skinOn), active: () => app.state.skinOn },
      { type: 'slider', x: 210, y: 200, w: 330, h: 26, label: 'Fade', value: () => app.state.skinOpacity, onChange: v => app.setSkinOpacity(v) },
      { type: 'label', x: 22, y: 246, w: 200, h: 24, label: 'Side', size: 22, color: '#9fb3ba' },
      { type: 'button', x: 20, y: 272, w: 160, h: 50, label: 'Right hip', size: 26, onPress: () => app.setSide('right'), active: () => app.state.side === 'right' },
      { type: 'button', x: 190, y: 272, w: 160, h: 50, label: 'Left hip', size: 26, onPress: () => app.setSide('left'), active: () => app.state.side === 'left' },
      { type: 'button', x: 20, y: 334, w: 250, h: 52, label: 'Reset position', size: 26, onPress: () => xr.goHome() },
      { type: 'button', x: 290, y: 334, w: 250, h: 52, label: 'Exit VR', size: 28, color: '#7a2b25', onPress: () => app.exitVR() },
    ],
  });
}

function makeReductionPanel() {
  const auto = [['good', 'Good'], ['varus', 'Varus'], ['sag', 'Sag'], ['gap', 'Gap']];
  return new Panel({
    width: 0.56, height: 0.42, title: 'Reduction',
    items: [
      { type: 'label', x: 22, y: 50, w: 520, h: 26, size: 20, color: '#9fb3ba', label: 'Grip button: boot = foot, blue T-handle = pin, tray = tools' },
      { type: 'button', x: 20, y: 84, w: 255, h: 58, label: 'Free leg', size: 28, onPress: () => app.freeLeg(), active: () => sim.footHold.active },
      { type: 'button', x: 285, y: 84, w: 255, h: 58, label: 'Free pin', size: 28, onPress: () => app.freePin(), active: () => sim.pinHold.active },
      { type: 'label', x: 22, y: 150, w: 300, h: 24, size: 22, color: '#9fb3ba', label: 'Auto-reduce' },
      ...auto.map(([id, label], i) => ({ type: 'button', x: 20 + i * 132, y: 176, w: 124, h: 58, label, size: 26,
        onPress: () => app.autoReduce(id), active: () => !!reducer.anim && reducer.anim.kind === id })),
      { type: 'button', x: 20, y: 244, w: 255, h: 56, label: 'Restart fracture', size: 26, onPress: () => app.restartFracture() },
      { type: 'button', x: 285, y: 244, w: 255, h: 56, label: () => (app.state.muscles ? 'Muscles ON' : 'Muscles OFF'), size: 26,
        onPress: () => app.setMuscles(!app.state.muscles), active: () => app.state.muscles },
      { type: 'label', x: 22, y: 312, w: 520, h: 30, size: 21, color: '#ffe08a', label: () => app.readout1 || '' },
      { type: 'label', x: 22, y: 346, w: 520, h: 30, size: 21, color: '#ffe08a', label: () => app.readout2 || '' },
      { type: 'label', x: 22, y: 380, w: 520, h: 30, size: 21, color: '#c8d8dc', label: () => reducer.status || '' },
    ],
  });
}

/** controller pose (world) -> patient frame (mm), handling the mirror for a left hip */
function poseLocal(pose) {
  const pos = patient.toLocal(pose.pos);
  const q = pose.quat.clone();
  if (app.state.side === 'left') { q.y = -q.y; q.z = -q.z; }
  return { pos, q };
}

function makeGrabbables() {
  const foot = {
    id: 'foot', radius: 0.16,
    worldPos: out => fracView.worldPoint('D', fracView.footHandle, out),
    grab: pose => {
      reducer.anim = null; reducer.ref = null; hud.resetSliders();
      const c = poseLocal(pose);
      const qi = c.q.clone().invert();
      foot.start = { off: sim.D.pos.clone().sub(c.pos).applyQuaternion(qi), qoff: qi.multiply(sim.D.q.clone()) };
    },
    move: pose => {
      const c = poseLocal(pose);
      const pos = foot.start.off.clone().applyQuaternion(c.q).add(c.pos);
      sim.holdFoot(pos, c.q.clone().multiply(foot.start.qoff), 0.02);
    },
    release: () => { refresh(); }, // the boot keeps the foot where it was let go
    highlight: on => fracView.setHighlight('foot', on),
  };
  const pin = {
    id: 'pin', radius: 0.1,
    worldPos: out => fracView.worldPoint('P', fracView.pinHandle, out),
    grab: pose => {
      reducer.anim = null; reducer.ref = null; hud.resetSliders();
      const c = poseLocal(pose);
      pin.start = { qoff: c.q.clone().invert().multiply(sim.P.q.clone()) };
    },
    move: pose => sim.holdPin(poseLocal(pose).q.multiply(pin.start.qoff), 0.02),
    release: () => { refresh(); }, // an assistant keeps holding the pin
    highlight: on => fracView.setHighlight('pin', on),
  };
  return [foot, pin, ...tools.grabbables()];
}

// ---------- browser taps on 3D panels / monitor screens ----------
function setupPointer() {
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || renderer.xr.isPresenting) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 8 || !quick) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [monitor.panel.mesh, monitor.screens.AP.mesh, monitor.screens.LAT.mesh, monitor.screens.OBL.mesh];
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return;
    if (hit.object.userData.panel) {
      hit.object.userData.panel.pointerDown(-1, hit.uv);
      hit.object.userData.panel.pointerUp(-1);
    } else if (hit.object.userData.view) {
      document.getElementById('pip').classList.add('big');
    }
  });
}

// ---------- start ----------
async function start() {
  hud.setProgress(0.02, 'Loading CT data…');
  const assets = await loadAssets(ASSETS, p => hud.setProgress(0.05 + 0.85 * p, `Loading CT data… ${Math.round(p * 100)}%`));
  hud.setProgress(0.93, 'Building the operating room…');
  hud.setCase(`${assets.meta.case} (${assets.meta.patient})`);

  patient = new Patient(assets.gltf, assets.meta);
  scene.add(patient.root);
  room.userData.post.position.z = patient.toWorld(new THREE.Vector3(0, 0, assets.meta.body.crotchZ + 20)).z;
  carm = new CArm();
  scene.add(carm.root);
  drr = new DRR(renderer, assets.volume, assets.meta);
  drr.onImage = imageDone;
  monitor = new Monitor(drr.canvases, app);
  scene.add(monitor.root);
  sim = new FractureSim(assets.meta, assets.fracture);
  reducer = new Reducer(sim);
  tuning = new Tuning(app, sim);
  fracView = new FractureView(patient, sim);
  tools = new Tools();
  scene.add(tools.root);
  hud.setProgress(0.96, 'Letting the muscles displace the fracture…');
  await new Promise(r => setTimeout(r, 30));
  sim.settle(5);
  fracView.update();

  controlPanel = makeControlPanel();
  reductionPanel = makeReductionPanel();
  for (const p of [controlPanel, reductionPanel]) { p.mesh.visible = false; scene.add(p.mesh); }

  const grabbables = makeGrabbables();
  xr = new XRSystem(renderer, rig, camera, () => [monitor.panel, controlPanel, reductionPanel], () => grabbables);
  let savedCam = null;
  xr.onStart = () => {
    app.state.inVR = true;
    savedCam = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: controls.target.clone() };
    controls.enabled = false;
    hud.setVisible(false);
    controlPanel.mesh.visible = true;
    reductionPanel.mesh.visible = true;
    xr.goHome();
  };
  xr.onEnd = () => {
    app.state.inVR = false;
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    controlPanel.mesh.visible = false;
    reductionPanel.mesh.visible = false;
    for (const it of tools.items) if (it.held) tools.goHome(it);
    hud.setVisible(true);
    controls.enabled = true;
    if (savedCam) {
      camera.position.copy(savedCam.pos);
      camera.quaternion.copy(savedCam.quat);
      controls.target.copy(savedCam.target);
    }
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  setupPointer();
  patient.setSkin(true, 1);
  applySide();
  refresh();
  hud.showVRButton(await vrSupported());
  hud.hideLoading();

  const clock = new THREE.Clock();
  let readT = 0, wasAnim = false;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (renderer.xr.isPresenting) xr.update(dt);
    else controls.update();
    // physics
    sim.tools = tools.tips(patient);
    reducer.update(dt);
    sim.update(dt);
    fracView.update();
    if (wasAnim && !reducer.anim) { app.shoot('LAT'); app.shoot('AP'); }
    wasAnim = !!reducer.anim;
    if (shootAfterSettle > 0) {
      shootAfterSettle -= dt;
      if (shootAfterSettle <= 0) shootAll();
    }
    // numbers for the panels a few times per second
    readT -= dt;
    if (readT <= 0) {
      readT = 0.25;
      const m = sim.measures();
      const t = readoutText(m);
      hud.readout(t);
      const cut = t.indexOf(' · rotation');
      app.readout1 = t.slice(0, cut);
      app.readout2 = t.slice(cut + 3).replace(/ · (Reducing…|.*held)$/, '');
      tuning.refresh(m);
      if (reductionPanel.mesh.visible) reductionPanel.draw();
    }
    carm.update(dt);
    drr.tick();
    renderer.render(scene, camera);
  });
}

start().catch(err => {
  console.error(err);
  hud.showError('Sorry, loading failed: ' + err.message);
});

// for testing in the browser console
window.__app = app;
Object.defineProperty(window, "__drr", { get: () => drr });
Object.defineProperty(window, "__patient", { get: () => patient });
Object.defineProperty(window, "__vr", { get: () => ({ rig, controlPanel, reductionPanel, monitor, renderer, fracView, tools, camera, controls }) });
Object.defineProperty(window, "__sim", { get: () => sim });
