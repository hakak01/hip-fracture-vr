// Hip Fracture VR Trainer — milestone 1: scene, CT anatomy, skin, side choice, C-arm with DRR, VR.
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

const ASSETS = 'assets/ct/';

const app = {
  state: { side: 'right', skinOn: true, skinOpacity: 1, invert: false, busy: null, live: null, inVR: false },
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

let patient, carm, drr, monitor, controlPanel, xr;
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
  for (const v of ['AP', 'LAT']) {
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
  controlPanel.mesh.position.set(-0.85 * s, 1.12, 0.62);
  controlPanel.mesh.lookAt(-0.6 * s, 1.75, 0.05);
  queue.length = 0;
  app.shoot('LAT');
  app.shoot('AP');
  if (!renderer.xr.isPresenting) app.resetView();
}

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
  if (monitor) monitor.panel.draw();
}

// ---------- VR control panel ----------
function makeControlPanel() {
  return new Panel({
    width: 0.56, height: 0.4, title: 'Controls',
    items: [
      { type: 'label', x: 22, y: 52, w: 200, h: 24, label: 'C-arm', size: 22, color: '#9fb3ba' },
      { type: 'button', x: 20, y: 78, w: 160, h: 66, label: 'AP', onPress: () => app.shoot('AP'), active: () => app.state.busy === 'AP' },
      { type: 'button', x: 190, y: 78, w: 200, h: 66, label: 'LATERAL', onPress: () => app.shoot('LAT'), active: () => app.state.busy === 'LAT' },
      { type: 'button', x: 400, y: 78, w: 140, h: 66, label: 'Invert', size: 28, onPress: () => app.toggleInvert(), active: () => app.state.invert },
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
    const targets = [monitor.panel.mesh, monitor.screens.AP.mesh, monitor.screens.LAT.mesh];
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
  controlPanel = makeControlPanel();
  controlPanel.mesh.visible = false;
  scene.add(controlPanel.mesh);

  xr = new XRSystem(renderer, rig, camera, () => [monitor.panel, controlPanel]);
  let savedCam = null;
  xr.onStart = () => {
    app.state.inVR = true;
    savedCam = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: controls.target.clone() };
    controls.enabled = false;
    hud.setVisible(false);
    controlPanel.mesh.visible = true;
    xr.goHome();
  };
  xr.onEnd = () => {
    app.state.inVR = false;
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    controlPanel.mesh.visible = false;
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
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (renderer.xr.isPresenting) xr.update(dt);
    else controls.update();
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
Object.defineProperty(window, "__vr", { get: () => ({ rig, controlPanel, monitor, renderer }) });
