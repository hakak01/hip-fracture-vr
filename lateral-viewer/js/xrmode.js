// VR and passthrough (Meta Quest browser) for the lateral viewer.
// The bone model (mm) is put in a group scaled 0.001 (life size). The VR panel only presses the page's own
// controls (click() / set value + 'input'), so the page and VR always agree.
// Nothing here runs until the user enters VR; the 2D page is not changed.
import * as THREE from 'three';
import { XRSystem, vrSupported, arSupported } from '../../js/xr.js';
import { Panel } from '../../js/panel.js';

const MODEL_POS = new THREE.Vector3(0, 1.0, -0.6); // model centre (the C-arm isocentre): 1 m high, 0.6 m ahead
const HOLD_EXIT_S = 1;

export function setupXR({ renderer, view, drr, getGeom, $ }) {
  const scene = view.scene, camera = view.camera;
  const iso = new THREE.Vector3().fromArray(view.meta.carm.iso);
  const lat = new THREE.Vector3().fromArray(view.meta.carm.lateralDir);
  const UP = new THREE.Vector3(0, 1, 0);

  // ---- 3D objects used only in XR ----
  const rig = new THREE.Group();            // holds the camera; moved by walking / turning / beam view
  const ui = new THREE.Group();             // monitor + panel; follows the rig when it jumps (beam view)
  const holder = new THREE.Group();         // the grabbed object (metres)
  const modelG = new THREE.Group();         // bones and beam, mm -> m
  modelG.scale.setScalar(0.001);
  modelG.position.copy(iso).multiplyScalar(-0.001); // isocentre at the holder's origin
  holder.add(modelG);
  const floor = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshBasicMaterial({ color: 0x1d2328 }));
  disc.rotation.x = -Math.PI / 2;
  const grid = new THREE.GridHelper(6, 12, 0x3a525c, 0x2a363d);
  grid.position.y = 0.002;
  floor.add(disc, grid);

  // patient lies flat; turn it about the vertical so the lateral beam runs left-right across my view
  const yaw = Math.atan2(lat.z, lat.x);
  const resetModel = () => {
    holder.position.copy(MODEL_POS);
    holder.quaternion.setFromAxisAngle(UP, yaw);
    holder.updateMatrix();
  };

  // X-ray monitor, left-front
  const monitor = new THREE.Group();
  const tex = new THREE.CanvasTexture(drr.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const S = 0.42;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(S + 0.03, S + 0.03), new THREE.MeshBasicMaterial({ color: 0x15191c }));
  frame.position.z = -0.002;
  monitor.add(frame, screen);
  monitor.position.set(-0.62, 1.35, -0.3);
  ui.add(monitor);
  monitor.lookAt(0, 1.35, 0);

  // ---- control panel, right-front ----
  const sel = $('preset'), sev = $('sev'), tilt = $('tilt'), roll = $('roll');
  const click = id => () => $(id).click();
  const on = id => () => $(id).classList.contains('on');
  const fire = (el, type) => el.dispatchEvent(new Event(type));
  const stepPreset = d => {
    const n = sel.options.length;
    sel.value = (Number(sel.value) + d + n) % n;
    fire(sel, 'change');
  };
  const slider = (el, y, label) => ({
    type: 'slider', x: 34, y, w: 572, h: 34, label,
    value: () => (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min)),
    onChange: v => { el.value = Math.round(Number(el.min) + v * (Number(el.max) - Number(el.min))); fire(el, 'input'); },
  });
  const row = (y, h, defs) => {
    const gap = 8, w = (600 - gap * (defs.length - 1)) / defs.length;
    return defs.map((d, i) => ({ type: 'button', x: 20 + i * (w + gap), y, w, h, size: 28, ...d }));
  };
  const spotCtx = document.createElement('canvas').getContext('2d');
  const spotLines = () => {
    spotCtx.font = '500 22px system-ui, sans-serif';
    const words = ($('spot').textContent || '').split(/\s+/), lines = [''];
    for (const w of words) {
      const t = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
      if (spotCtx.measureText(t).width > 590 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t;
    }
    if (lines.length > 4) { lines.length = 4; lines[3] = `${lines[3].slice(0, -1)}…`; }
    return lines;
  };
  const items = [
    ...row(40, 64, [{ label: '◀', onPress: () => stepPreset(-1) }]).map(b => ({ ...b, w: 84 })),
    { type: 'label', x: 112, y: 40, w: 416, h: 64, size: 28, weight: 700, align: 'center', color: '#ffffff', label: () => $('pname').textContent },
    { ...row(40, 64, [{ label: '▶', onPress: () => stepPreset(1) }])[0], x: 536, w: 84 },
    slider(sev, 154, () => `Mild – Severe  ${sev.value}%`),
    ...row(200, 60, [
      { label: 'Lateral', onPress: click('btnLat'), active: on('btnLat') },
      { label: 'AP', onPress: click('btnAP'), active: on('btnAP') },
    ]),
    slider(tilt, 320, () => `Tilt  ${$('tiltval').textContent}`),
    slider(roll, 400, () => `Roll  ${$('rollval').textContent}`),
    ...row(440, 60, [
      { label: 'True lateral of neck', size: 24, onPress: click('btnTrue'), active: on('btnTrue') },
      { label: 'Standard lateral', size: 24, onPress: click('btnStd') },
    ]),
    ...row(512, 60, [
      { label: 'Invert', onPress: click('btnInv'), active: on('btnInv') },
      { label: 'Colour fragments', size: 22, onPress: click('btnCol'), active: on('btnCol') },
      { label: 'Show beam', size: 24, onPress: click('btnBeam'), active: on('btnBeam') },
    ]),
    { type: 'label', x: 24, y: 582, w: 300, h: 28, size: 24, label: 'See-through' },
    ...row(614, 60, [
      { label: 'None', onPress: click('see_none'), active: on('see_none') },
      { label: 'Head-neck', size: 24, onPress: click('see_prox'), active: on('see_prox') },
      { label: 'Shaft', onPress: click('see_dist'), active: on('see_dist') },
    ]),
    ...row(690, 60, [
      { label: 'Beam view', size: 24, onPress: () => beamView() },
      { label: 'Reset view', size: 24, onPress: () => resetView() },
      { label: 'Reset model', size: 24, onPress: () => resetModel() },
    ]),
    { type: 'label', x: 24, y: 766, w: 580, h: 28, size: 24, weight: 700, color: '#ffe08a', label: 'How to spot it' },
    ...[0, 1, 2, 3].map(i => ({ type: 'label', x: 24, y: 796 + i * 28, w: 590, h: 28, size: 22, label: () => spotLines()[i] || '' })),
    { type: 'button', x: 20, y: 930, w: 600, h: 80, size: 38, weight: 700, color: '#a31616', activeColor: '#c42020', label: 'Exit VR', onPress: () => exit() },
  ];
  const panel = new Panel({ width: 0.64, height: 1.03, items });
  panel.mesh.position.set(0.66, 1.3, -0.3);
  ui.add(panel.mesh);
  panel.mesh.lookAt(0, 1.3, 0);

  // ---- grabbing the bone model ----
  const grabMat = new THREE.Matrix4(), offset = new THREE.Matrix4(), ONE = new THREE.Vector3(1, 1, 1);
  const poseMat = pose => grabMat.compose(pose.pos, pose.quat, ONE);
  const grabbable = {
    radius: 0.5,
    worldPos: v => holder.getWorldPosition(v),
    highlight: h => { for (const m of Object.values(view.mats)) m.emissive.setHex(h ? 0x1a3340 : 0x000000); },
    grab(pose) { holder.updateMatrix(); offset.copy(poseMat(pose)).invert().multiply(holder.matrix); },
    move(pose) {
      holder.matrix.copy(poseMat(pose)).multiply(offset);
      holder.matrix.decompose(holder.position, holder.quaternion, holder.scale);
      holder.scale.set(1, 1, 1);
    },
    release() {},
  };

  // ---- session ----
  const xr = new XRSystem(renderer, rig, camera, () => [panel], () => [grabbable]);
  scene.add(rig);
  let active = false, saved = null, moved = [], holdT = 0;
  const clock = new THREE.Clock();

  function enterScene(mode) {
    saved = {
      bg: scene.background, near: camera.near, far: camera.far, fov: camera.fov, aspect: camera.aspect,
      pos: camera.position.clone(), quat: camera.quaternion.clone(), up: camera.up.clone(),
      target: view.controls.target.clone(), beamParts: view.beamParts[0].visible,
    };
    moved = scene.children.filter(o => !o.isLight && !o.isCamera && o !== rig);
    for (const o of moved) modelG.add(o);
    scene.add(holder, ui);
    rig.add(camera);
    camera.position.set(0, 0, 0); camera.quaternion.identity();
    camera.near = 0.02; camera.far = 100; camera.updateProjectionMatrix();
    view.controls.enabled = false;
    if (mode === 'immersive-ar') {
      scene.background = null;              // the room shows through
      renderer.setClearColor(0x000000, 0);
    } else {
      scene.add(floor);
    }
    resetModel();
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    ui.position.set(0, 0, 0); ui.rotation.set(0, 0, 0);
    xr.setHome(new THREE.Vector3(), 0);
    renderer.xr.enabled = true;
    active = true;
    view.showBeamParts(true);
    panel.draw();
  }

  function leaveScene() {
    if (!active && !saved) return;
    active = false;
    renderer.xr.enabled = false;
    for (const o of moved) scene.add(o);
    moved = [];
    scene.remove(holder, ui, floor);
    scene.add(camera);
    if (saved) {
      scene.background = saved.bg;
      camera.near = saved.near; camera.far = saved.far; camera.fov = saved.fov; camera.aspect = saved.aspect;
      view.setUp(saved.up);
      camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat);
      view.controls.target.copy(saved.target);
      camera.updateProjectionMatrix();
      view.showBeamParts(saved.beamParts);
      saved = null;
    }
    renderer.setClearColor(0x000000, 1);
    view.controls.enabled = true;
    view.controls.update();
    for (const m of Object.values(view.mats)) m.emissive.setHex(0x000000);
    window.dispatchEvent(new Event('resize'));
  }
  xr.onEnd = leaveScene;

  async function start(mode) {
    if (active) return;
    try {
      enterScene(mode);
      await xr.enter(mode);
    } catch (e) {
      console.error(e);
      leaveScene();
    }
  }
  function exit() { xr.exit(); }

  function resetView() {
    xr.goHome();
    ui.position.set(0, 0, 0); ui.rotation.set(0, 0, 0);
    view.showBeamParts(true);
  }

  /** Move me to the X-ray source, facing along the beam (the C-arm's own view). */
  function beamView() {
    const g = getGeom();
    if (!g || !active) return;
    const srcW = modelG.localToWorld(g.src.clone());
    const dirW = g.dir.clone().transformDirection(holder.matrixWorld);
    const head = camera.getWorldPosition(new THREE.Vector3());
    const face = camera.getWorldDirection(new THREE.Vector3()); face.y = 0;
    const dh = dirW.clone(); dh.y = 0;
    if (face.lengthSq() < 1e-6 || dh.lengthSq() < 1e-6) return;
    face.normalize(); dh.normalize();
    const turn = Math.atan2(face.z * dh.x - face.x * dh.z, face.dot(dh));
    const shift = srcW.clone().sub(head); // after the turn about the head, the head is moved onto the source
    for (const o of [rig, ui]) {
      o.position.sub(head).applyAxisAngle(UP, turn).add(head).add(shift);
      o.rotation.y += turn;
    }
    view.showBeamParts(false);
  }

  // ---- per frame ----
  function frame() {
    const dt = Math.min(0.1, clock.getDelta());
    xr.update(dt);
    // hold B or Y for 1 s to leave
    let held = false;
    for (const s of xr.controllers) {
      const gp = s.source && s.source.gamepad;
      if (gp && gp.buttons[5] && gp.buttons[5].pressed) held = true;
    }
    holdT = held ? holdT + dt : 0;
    if (holdT >= HOLD_EXIT_S) { holdT = 0; exit(); return; }
    renderer.render(scene, camera);
  }

  // ---- page buttons, shown only when supported ----
  const wire = async (id, check, mode) => {
    const b = $(id);
    if (!b || !await check()) return;
    b.style.display = '';
    b.onclick = () => start(mode);
    $('xrrow').style.display = '';
  };
  wire('btnVR', vrSupported, 'immersive-vr');
  wire('btnAR', arSupported, 'immersive-ar');

  return {
    get active() { return active; },
    frame,
    imageUpdated() { tex.needsUpdate = true; },
    sync() { if (active) panel.draw(); },
  };
}
