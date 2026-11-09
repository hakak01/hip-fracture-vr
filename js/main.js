// Hip Fracture VR Trainer — milestone 3: movable C-arm, DHS guidewire, scoring.
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
import { DHS, WIRE_LEN, BARREL } from './dhs.js';
import { Sounds } from './audio.js';
import { scoreWire, scoreLines } from './score.js';

const ASSETS = 'assets/ct/';

const app = {
  state: { side: 'right', skinOn: true, skinOpacity: 1, invert: false, busy: null, live: null, inVR: false, muscles: true,
    laser: true, shots: 0, seconds: 0, drill: 0 },
  scoreText: [],
};
const hud = new HUD(app);
const sounds = new Sounds();
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sounds.unlock(), { capture: true });

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

let patient, carm, drr, monitor, controlPanel, reductionPanel, xr, sim, fracView, reducer, tools, tuning, dhs;
let frameDt = 1 / 60;
let drillingNow = false;
let shootAfterSettle = 0; // seconds of settling left before automatic AP/LAT shots
const sideSign = () => (app.state.side === 'right' ? 1 : -1);

// ---------- app actions (shared by the HTML bar and the VR panels) ----------
const queue = [];
/** X-ray. With a preset ('AP', 'LAT', 'OBL') the C-arm first swings there; without, it shoots where it is. */
app.shoot = view => {
  if (!drr) return;
  const key = view || 'HERE';
  if (app.state.busy) { if (!queue.includes(key)) queue.push(key); return; }
  app.state.busy = key;
  refresh();
  if (key === 'HERE') expose();
  else carm.moveTo(key, expose);
};

function expose() {
  app.state.shots++;
  app.state.seconds += 0.4;
  sounds.beep();
  carm.beam.visible = true;
  sim.matrixP(drr.fragments[0].matrix);
  sim.matrixD(drr.fragments[1].matrix);
  const p = projectionLocal();
  drr.shoot(p.screen, p, collectMetal(), {
    label: carm.viewName(), angles: carm.angleText(), count: app.state.shots, seconds: app.state.seconds,
  });
}

function projectionLocal() {
  const p = carm.projection();
  const src = patient.toLocal(p.src);
  const det = patient.toLocal(p.det);
  const U = patient.toLocal(p.det.clone().addScaledVector(p.u, p.radius)).sub(det);
  const V = patient.toLocal(p.det.clone().addScaledVector(p.v, p.radius)).sub(det);
  return { src, det, U, V, screen: p.screen };
}

/** steel objects in the beam, in the patient frame (mm) */
function collectMetal() {
  const out = { cyl: [], box: [] };
  for (const m of fracView.pinMetal) {
    out.cyl.push({ a: m.a.clone().applyMatrix4(fracView.mP), b: m.b.clone().applyMatrix4(fracView.mP), r: m.r, mu: 0.9 });
  }
  dhs.metal(out);
  for (const it of tools.items) {
    if (!it.held) continue;
    it.group.updateMatrixWorld();
    const a = patient.toLocal(it.tip.clone().applyMatrix4(it.group.matrixWorld));
    const b = patient.toLocal(new THREE.Vector3(0, 0, -0.06).applyMatrix4(it.group.matrixWorld));
    out.cyl.push({ a, b, r: it.kind === 'spike' ? 3.5 : 5, mu: 0.9 });
  }
  return out;
}

function imageDone(screen) {
  carm.beam.visible = false;
  app.state.busy = null;
  app.state.live = screen;
  monitor.imageUpdated(screen);
  hud.showImage(screen, drr.canvases[screen], screen);
  refresh();
  if (queue.length) { const k = queue.shift(); app.shoot(k === 'HERE' ? undefined : k); }
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
  for (const [panel, z, y] of [[controlPanel, 0.85, 1.15], [reductionPanel, -0.62, 1.3]]) {
    panel.mesh.position.set(-0.95 * s, y, z);
    panel.mesh.lookAt(-0.6 * s, 1.75, 0.08);
  }
  tools.place(s);
  queue.length = 0;
  shootAll();
  if (!renderer.xr.isPresenting) app.resetView();
}

function shootAll() {
  app.shoot('LAT');
  app.shoot('AP');
}

app.setCarm = (key, v) => { carm.set({ [key]: v }); };
app.toggleLaser = () => { app.state.laser = !app.state.laser; carm.laserOn = app.state.laser; carm.version++; refresh(); };

// ---------- DHS guidewire ----------
app.placeGuide = () => {
  if (dhs.placeGuide()) { hud.guideChanged(dhs.guide); sounds.click(); } else hud.toast(dhs.status);
  refresh();
};
app.removeGuide = () => { dhs.removeGuide(); if (dhs.status) hud.toast(dhs.status); refresh(); };
app.setGuide = (key, v) => {
  if (!dhs.placeGuide({ [key]: v })) hud.toast(dhs.status);
  hud.guideChanged(dhs.guide);
  refresh();
};
app.setDrill = dir => {
  if (dir && !dhs.guide.placed) { hud.toast('Place the angle guide first (Wire tab).'); return; }
  app.state.drill = dir;
};
app.removeWire = () => { dhs.removeWire(); hud.hideScore(); app.scoreText = []; refresh(); };
app.score = () => {
  const sc = scoreWire(sim, dhs, fracView);
  app.scoreText = scoreLines(sc, sim.measures(), app.state.shots, app.state.seconds);
  hud.showScore(app.scoreText);
  hud.toast(app.scoreText[0] + (sc ? ` — TAD ${sc.tad.toFixed(0)} mm, zone ${sc.zone}` : ''), 3500);
  sounds.click();
  refresh();
};

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
  if (sim.pinned) { hud.toast('The guidewire is holding the fracture. Remove the wire first.'); return; }
  hud.resetSliders();
  reducer.autoReduce(kind);
  app.state.autoKind = kind;
  refresh();
};

app.restartFracture = () => {
  dhs.removeWire();
  dhs.removeGuide();
  app.scoreText = [];
  hud.hideScore();
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

// ---------- VR panels ----------
function makeControlPanel() {
  return new Panel({
    width: 0.56, height: 0.47, title: 'C-arm & view',
    items: [
      { type: 'button', x: 20, y: 56, w: 100, h: 62, label: 'AP', onPress: () => app.shoot('AP'), active: () => app.state.busy === 'AP' },
      { type: 'button', x: 128, y: 56, w: 110, h: 62, label: 'LAT', onPress: () => app.shoot('LAT'), active: () => app.state.busy === 'LAT' },
      { type: 'button', x: 246, y: 56, w: 134, h: 62, label: 'OBL 30°', size: 28, onPress: () => app.shoot('OBL'), active: () => app.state.busy === 'OBL' },
      { type: 'button', x: 388, y: 56, w: 152, h: 62, label: '☢ X-RAY', size: 28, color: '#6b4d10', activeColor: '#c98a10', onPress: () => app.shoot(), active: () => app.state.busy === 'HERE' },
      { type: 'label', x: 22, y: 124, w: 520, h: 26, size: 19, color: '#9fb3ba', label: 'Grip blue ring = rotate C-arm · blue bar = move it · A/X = pedal' },
      { type: 'button', x: 20, y: 156, w: 120, h: 54, label: 'Invert', size: 26, onPress: () => app.toggleInvert(), active: () => app.state.invert },
      { type: 'button', x: 148, y: 156, w: 120, h: 54, label: 'Laser', size: 26, onPress: () => app.toggleLaser(), active: () => app.state.laser },
      { type: 'label', x: 280, y: 156, w: 260, h: 54, size: 20, color: '#ffe08a', label: () => carm.angleText().replace(/ {2}/g, ' ') },
      { type: 'button', x: 20, y: 222, w: 160, h: 58, label: () => (app.state.skinOn ? 'Skin ON' : 'Skin OFF'), size: 26, onPress: () => app.setSkinOn(!app.state.skinOn), active: () => app.state.skinOn },
      { type: 'slider', x: 210, y: 244, w: 330, h: 26, label: 'Fade', value: () => app.state.skinOpacity, onChange: v => app.setSkinOpacity(v) },
      { type: 'button', x: 20, y: 292, w: 160, h: 54, label: 'Right hip', size: 26, onPress: () => app.setSide('right'), active: () => app.state.side === 'right' },
      { type: 'button', x: 190, y: 292, w: 160, h: 54, label: 'Left hip', size: 26, onPress: () => app.setSide('left'), active: () => app.state.side === 'left' },
      { type: 'button', x: 360, y: 292, w: 180, h: 54, label: () => (app.state.muscles ? 'Muscles ON' : 'Muscles OFF'), size: 24,
        onPress: () => app.setMuscles(!app.state.muscles), active: () => app.state.muscles },
      { type: 'button', x: 20, y: 360, w: 250, h: 56, label: 'Reset position', size: 26, onPress: () => xr.goHome() },
      { type: 'button', x: 290, y: 360, w: 250, h: 56, label: 'Exit VR', size: 28, color: '#7a2b25', onPress: () => app.exitVR() },
      { type: 'label', x: 22, y: 424, w: 520, h: 30, size: 19, color: '#9fb3ba', label: () => `X-rays: ${app.state.shots} (${app.state.seconds.toFixed(1)} s)` },
    ],
  });
}

function makeReductionPanel() {
  const auto = [['good', 'Good'], ['varus', 'Varus'], ['sag', 'Sag'], ['gap', 'Gap']];
  const line = (y, fn, color = '#ffe08a', size = 19) => ({ type: 'label', x: 22, y, w: 520, h: 26, size, color, label: fn });
  return new Panel({
    width: 0.56, height: 0.76, title: 'Reduction & DHS',
    items: [
      line(48, 'Grip: boot = foot · blue T-handle = pin · tray = tools', '#9fb3ba', 18),
      { type: 'button', x: 20, y: 78, w: 255, h: 54, label: 'Free leg', size: 26, onPress: () => app.freeLeg(), active: () => sim.footHold.active },
      { type: 'button', x: 285, y: 78, w: 255, h: 54, label: 'Free pin', size: 26, onPress: () => app.freePin(), active: () => sim.pinHold.active },
      line(138, 'Auto-reduce', '#9fb3ba', 20),
      ...auto.map(([id, label], i) => ({ type: 'button', x: 20 + i * 132, y: 162, w: 124, h: 52, label, size: 25,
        onPress: () => app.autoReduce(id), active: () => !!reducer.anim && reducer.anim.kind === id })),
      { type: 'button', x: 20, y: 222, w: 255, h: 50, label: 'Restart fracture', size: 24, onPress: () => app.restartFracture() },
      line(280, () => app.readout1 || ''),
      line(306, () => app.readout2 || ''),
      line(338, 'DHS guidewire — tray: angle guide, drill (trigger = drill)', '#9fb3ba', 18),
      { type: 'button', x: 20, y: 366, w: 255, h: 52, label: 'Place guide', size: 25, onPress: () => app.placeGuide(), active: () => dhs.guide.placed },
      { type: 'button', x: 285, y: 366, w: 255, h: 52, label: 'Remove guide', size: 25, onPress: () => app.removeGuide() },
      { type: 'button', x: 20, y: 426, w: 255, h: 52, label: 'Remove wire', size: 25, onPress: () => app.removeWire() },
      { type: 'button', x: 285, y: 426, w: 255, h: 52, label: 'Score', size: 27, color: '#2c5f3a', onPress: () => app.score() },
      line(486, () => dhs.statusText(), '#c8d8dc', 18),
      line(520, () => app.scoreText[0] || '', '#ffe08a', 22),
      line(552, () => app.scoreText[1] || ''),
      line(580, () => app.scoreText[2] || ''),
      line(608, () => (app.scoreText[3] || '').slice(0, 62)),
      line(636, () => (app.scoreText[3] || '').slice(62)),
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
  const ring = {
    id: 'carm-ring', radius: 0.26,
    worldPos: out => carm.ringWorld(out),
    grab: pose => carm.grabRing(pose.pos),
    move: pose => carm.dragTo(pose.pos),
    release: () => carm.release(),
    highlight: on => carm.highlight('ring', on),
  };
  const bar = {
    id: 'carm-bar', radius: 0.16,
    worldPos: out => carm.barWorld(out),
    grab: pose => carm.grabBar(pose.pos),
    move: pose => carm.dragTo(pose.pos),
    release: () => carm.release(),
    highlight: on => carm.highlight('bar', on),
  };
  const guide = {
    id: 'guide', radius: 0.11,
    worldPos: out => (dhs.guide.placed ? fracView.worldPoint('D', dhs.gripRest(), out) : dhs.guideFree.getWorldPosition(out)),
    grab: () => {
      guide.locked = dhs.wireInBone;
      if (guide.locked) hud.toast('Withdraw the wire before moving the guide.');
      guide.held = true;
    },
    move: pose => {
      if (guide.locked) return;
      const p = dhs.guideFromHand(patient.toLocal(pose.pos));
      if (p.lateralDist < 75) {
        dhs.placeGuide({ h: p.h, rot: p.rot });
        hud.guideChanged(dhs.guide);
      } else {
        if (dhs.guide.placed && !dhs.wire.inGuide) dhs.removeGuide();
        if (!dhs.guide.placed) {
          dhs.guideFree.quaternion.copy(pose.quat);
          dhs.guideFree.position.copy(pose.pos).sub(new THREE.Vector3(0.15, 0, 0.048).applyQuaternion(pose.quat));
        }
      }
    },
    release: () => { guide.held = false; refresh(); },
    highlight: on => dhs.gripMat.emissive.setHex(on ? 0x335533 : 0x000000),
  };
  const drill = {
    id: 'drill', radius: 0.12,
    worldPos: out => dhs.drill.localToWorld(out.copy(dhs.drillGrip)),
    grab: () => { drill.held = true; drill.snapped = false; },
    move: (pose, s) => {
      if (!drill.snapped) {
        // free in the hand: hold it by the handle
        dhs.drill.quaternion.copy(pose.quat);
        dhs.drill.position.copy(pose.pos).sub(dhs.drillGrip.clone().applyQuaternion(pose.quat));
        dhs.drill.updateMatrixWorld();
        if (!dhs.guide.placed) return;
        const axis = wireAxisWorld();
        let target, chuck = dhs.drill.localToWorld(new THREE.Vector3(0, 0, -0.065));
        if (!dhs.wire.inGuide) {
          // loaded wire: its tip into the guide sleeve
          const tipW = dhs.drill.localToWorld(new THREE.Vector3(0, 0, -0.065 - WIRE_LEN / 1000));
          target = axis.entry; chuck = tipW;
        } else {
          target = axis.tail; // pick up the wire left in the guide
        }
        if (chuck.distanceTo(target) < 0.06) {
          if (!dhs.wire.inGuide) dhs.insertWire();
          drill.snapped = true;
          drill.hand0 = pose.pos.clone();
          drill.d0 = dhs.wire.depth;
          xr.pulse(s, 0.6, 60);
        }
        return;
      }
      // on the wire: pushing along the wire advances it while the trigger runs the drill
      const axis = wireAxisWorld();
      const target = drill.d0 + pose.pos.clone().sub(drill.hand0).dot(axis.dir) * 1000;
      const trig = xr.trigger(s);
      const depth = dhs.wire.depth;
      if (target > depth + 0.3 && trig > 0.1) {
        const load = dhs.drive(Math.min(target - depth, dhs.speed() * trig * frameDt));
        drillingNow = true;
        sounds.drill(true, load);
        xr.pulse(s, 0.15 + 0.6 * load, 30);
        if (dhs.blocked) xr.pulse(s, 1, 80);
      } else if (target < depth - 0.3) {
        dhs.drive(Math.max(target - depth, -40 * frameDt));
        if (trig > 0.1) { drillingNow = true; sounds.drill(true, 0.15); }
      } else if (trig > 0.1) { drillingNow = true; sounds.drill(true, 0); }
      if (!dhs.wire.inGuide) drill.snapped = false; // withdrawn completely: wire comes out with the drill
    },
    release: () => { drill.held = false; drill.snapped = false; },
    highlight: on => dhs.drillMat.emissive.setHex(on ? 0x224422 : 0x000000),
  };
  app.drillGrab = drill;
  app.guideGrab = guide;
  return [foot, pin, ring, bar, guide, drill, ...tools.grabbables()];
}

/** guide sleeve entry, wire tail and wire direction in the world */
function wireAxisWorld() {
  const mD = fracView.mD;
  const dir = patient.dirToWorld(dhs.w.clone().transformDirection(mD));
  const entry = patient.toWorld(dhs.E.clone().addScaledVector(dhs.w, -BARREL).applyMatrix4(mD));
  const tail = patient.toWorld(dhs.E.clone().addScaledVector(dhs.w, dhs.wire.depth - WIRE_LEN).applyMatrix4(mD));
  return { dir, entry, tail };
}

/** drill and loose guide: in the hand, on the wire, or on the tray */
function placeHeldObjects() {
  const drill = app.drillGrab, guide = app.guideGrab;
  const onWire = dhs.wire.inGuide && (drill.snapped || (!drill.held && !app.state.inVR));
  if (onWire) {
    const a = wireAxisWorld();
    const z = a.dir.clone().negate();
    const up = new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    dhs.drill.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    dhs.drill.position.copy(a.tail).addScaledVector(a.dir, 0.065);
  } else if (!drill.held) {
    dhs.drill.position.copy(tools.slots[3]).add(new THREE.Vector3(0, 0.02, 0));
    dhs.drill.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  }
  dhs.guideFree.visible = !dhs.guide.placed;
  if (!dhs.guide.placed && !guide.held) {
    dhs.guideFree.position.copy(tools.slots[2]);
    dhs.guideFree.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  }
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
  sim = new FractureSim(assets.meta, assets.fracture);
  reducer = new Reducer(sim);
  tuning = new Tuning(app, sim);
  fracView = new FractureView(patient, sim);
  tools = new Tools();
  scene.add(tools.root);
  dhs = new DHS({ sim, fracView, patient, volume: assets.volume, meta: assets.meta, sounds });
  tools.root.add(dhs.drill, dhs.guideFree);
  hud.setProgress(0.96, 'Letting the muscles displace the fracture…');
  await new Promise(r => setTimeout(r, 30));
  sim.settle(5);
  fracView.update();

  controlPanel = makeControlPanel();
  reductionPanel = makeReductionPanel();
  for (const p of [controlPanel, reductionPanel]) { p.mesh.visible = false; scene.add(p.mesh); }

  const grabbables = makeGrabbables();
  xr = new XRSystem(renderer, rig, camera, () => [monitor.panel, controlPanel, reductionPanel], () => grabbables);
  xr.onPedal = () => app.shoot();
  let savedCam = null;
  xr.onStart = () => {
    app.state.inVR = true;
    sounds.unlock();
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
  let readT = 0, wasAnim = false, laserT = 0, laserV = -1, carmV = -1;
  const laserTargets = () => (app.state.skinOn ? [patient.meshes.skin]
    : [patient.meshes.femur_prox, patient.meshes.femur_dist, patient.meshes.pelvis]).filter(Boolean);
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    frameDt = dt;
    drillingNow = false;
    if (renderer.xr.isPresenting) xr.update(dt);
    else controls.update();
    // browser drilling (press and hold)
    if (app.state.drill) {
      if (!dhs.wire.inGuide) dhs.insertWire();
      if (dhs.wire.inGuide) {
        const load = dhs.drive(app.state.drill > 0 ? dhs.speed() * dt : -20 * dt);
        drillingNow = true;
        sounds.drill(true, app.state.drill > 0 ? load : 0.15);
      }
    }
    if (!drillingNow) sounds.drill(false);
    placeHeldObjects();
    // C-arm: laser and slider values when it moved
    // laser: hidden while the C-arm moves, placed again once it has stopped (keeps VR smooth)
    if (carm.version !== carmV) { carmV = carm.version; laserT = 0.25; carm.laser.visible = false; hud.carmChanged(carm.state, carm.angleText()); }
    laserT -= dt;
    if (carm.version !== laserV && laserT <= 0) { laserV = carm.version; carm.updateLaser(laserTargets()); }
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
      hud.wireStatus(dhs.statusText());
      if (reductionPanel.mesh.visible) reductionPanel.draw();
      if (controlPanel.mesh.visible) controlPanel.draw();
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
Object.defineProperty(window, "__vr", { get: () => ({ rig, controlPanel, reductionPanel, monitor, renderer, fracView, tools, camera, controls, xr }) });
Object.defineProperty(window, "__sim", { get: () => sim });
Object.defineProperty(window, "__dhs", { get: () => dhs });
Object.defineProperty(window, "__carm", { get: () => carm });
