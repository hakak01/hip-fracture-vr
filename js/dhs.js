// DHS guidewire: 135° angle guide on the lateral cortex, 2.5 mm guidewire, power drill.
// The guide and wire sit on the distal fragment (they are defined in its rest frame, mm).
// The wire can be drilled in, withdrawn completely and re-inserted. Drilling is slower in cortical bone.
// Once the wire crosses into the head-neck fragment it holds the reduction (the fragments are pinned).
import * as THREE from 'three';
import { TABLE_TOP } from './room.js';

export const WIRE_LEN = 225;   // mm
export const WIRE_R = 1.25;    // mm (2.5 mm guidewire)
const BARREL = 40;             // mm, length of the guide sleeve outside the bone
const ANGLE = 135;             // degrees, plate angle
const D2R = Math.PI / 180;
const UPV = new THREE.Vector3(0, 1, 0);

export class DHS {
  constructor({ sim, fracView, patient, volume, meta, sounds }) {
    this.sim = sim;
    this.view = fracView;
    this.patient = patient;
    this.meta = meta;
    this.volume = volume;
    this.sounds = sounds;
    this.a = sim.shaft.clone();                                   // distal shaft axis
    const lat = new THREE.Vector3(-1, 0, 0);
    this.l0 = lat.addScaledVector(this.a, -lat.dot(this.a)).normalize(); // lateral, perpendicular to the shaft
    this.sLT = sim.attach.lt.clone().sub(sim.H).dot(this.a);
    this.guide = { placed: false, h: 0, rot: 0, ap: 0 };
    this.wire = { inGuide: false, depth: -BARREL };                // depth: mm past the lateral cortex
    this.passes = 0;
    this.perforated = false;
    this.blocked = false;
    this.lastHU = 0;
    this.drilling = 0;  // current drilling speed (for sound/haptics)
    this.status = '';
    this.centers = this.shaftCentres();
    this.buildMeshes();
    this.computeGuide();
  }

  // ---------- anatomy helpers ----------
  /** centre of the femoral cross-section at heights around the lesser trochanter (from the distal SDF) */
  shaftCentres() {
    const sdf = this.sim.sdfD, a = this.a, l = this.l0, t = new THREE.Vector3().crossVectors(a, l);
    const out = [];
    const guess = this.sim.attach.lt.clone().addScaledVector(l, 18).add(new THREE.Vector3(0, 8, 0));
    this.heightRef = guess.clone(); // guide height 0 = this level (lesser trochanter)
    const q = new THREE.Vector3();
    for (let h = -40; h <= 90; h += 10) {
      const base = guess.clone().addScaledVector(a, h);
      const c = new THREE.Vector3();
      let n = 0;
      for (let i = -24; i <= 24; i++) for (let j = -24; j <= 24; j++) {
        q.copy(base).addScaledVector(l, i * 2).addScaledVector(t, j * 2);
        if (sdf.sample(q) < 0) { c.add(q); n++; }
      }
      out.push({ h, c: n ? c.divideScalar(n) : base });
    }
    return out;
  }

  centreAt(h) {
    const cs = this.centers;
    const k = Math.max(0, Math.min(cs.length - 2, Math.floor((h - cs[0].h) / 10)));
    const f = Math.max(0, Math.min(1, (h - cs[k].h) / 10));
    return cs[k].c.clone().lerp(cs[k + 1].c, f);
  }

  /** guide pose (distal-fragment rest frame): entry point E, wire direction w, frame (a, t, l) */
  computeGuide() {
    const g = this.guide, a = this.a;
    const l = this.l0.clone().applyAxisAngle(a, g.rot * D2R);     // + rot = anteversion of the wire
    let t = new THREE.Vector3().crossVectors(a, l);
    if (t.y < 0) t.negate();                                     // anterior
    const start = this.centreAt(g.h).addScaledVector(t, g.ap);
    // march outwards to the lateral cortex surface
    const p = start.clone();
    for (let i = 0; i < 120; i++) {
      if (this.sim.sdfD.sample(p) > 0) break;
      p.addScaledVector(l, 0.5);
    }
    this.E = p;
    this.l = l;
    this.t = t;
    const c = Math.cos((180 - ANGLE) * D2R), s = Math.sin((180 - ANGLE) * D2R);
    this.w = a.clone().multiplyScalar(-c).addScaledVector(l, -s).normalize(); // 135° to the shaft, towards the head
    this.frame = new THREE.Matrix4().makeBasis(a, t, l).setPosition(p);
    this.placeMeshes();
  }

  // ---------- meshes ----------
  buildMeshes() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xc7cfd4, metalness: 0.85, roughness: 0.28 });
    this.steel = steel;
    this.gripMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.6 });
    // angle guide in its local frame (mm): x along the shaft (distal), y anterior, z lateral (out of the bone)
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(70, 18, 5), steel);
    plate.position.set(25, 0, 2.5);
    const outDir = new THREE.Vector3(Math.sin(45 * D2R), 0, Math.cos(45 * D2R)); // -w in guide coordinates
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, BARREL, 16, 1, true), steel);
    barrel.quaternion.setFromUnitVectors(UPV, outDir);
    barrel.position.copy(outDir).multiplyScalar(BARREL / 2);
    const rodA = new THREE.Vector3(58, 0, 5), rodB = new THREE.Vector3(150, 0, 48);
    const rod = cylBetween(rodA, rodB, 4, steel);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 80, 16), this.gripMat);
    grip.position.copy(rodB);
    g.add(plate, barrel, rod, grip);
    g.matrixAutoUpdate = false;
    g.visible = false;
    this.view.D.add(g);
    this.guideMesh = g;
    this.guideGeomLocal = { plateC: new THREE.Vector3(25, 0, 2.5), plateH: new THREE.Vector3(35, 9, 2.5), outDir, rodA, rodB };

    // the same guide as a hand-held object (world, metres) for VR before it is placed
    this.guideFree = g.clone();
    this.guideFree.matrixAutoUpdate = true;
    this.guideFree.visible = true;
    this.guideFree.scale.setScalar(0.001);
    this.guideFree.traverse(o => { if (o.material === this.gripMat) o.material = this.gripMat; });

    // wire (mm) in the distal-fragment frame
    const wg = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(WIRE_R, WIRE_R, WIRE_LEN - 12, 10), steel);
    shaft.position.y = -(12 / 2);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(WIRE_R * 1.1, WIRE_R * 0.4, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x8d969c, metalness: 0.9, roughness: 0.4 }));
    tip.position.y = WIRE_LEN / 2 - 6;
    wg.add(shaft, tip);
    wg.visible = false;
    this.view.D.add(wg);
    this.wireMesh = wg;

    // power drill (world, metres); the wire is drawn on it when loaded
    const drill = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.17), new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.5 }));
    body.position.z = 0.06;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.13, 0.05), new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.7 }));
    handle.position.set(0, -0.09, 0.1);
    const batt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.09), new THREE.MeshStandardMaterial({ color: 0x40474d, roughness: 0.6 }));
    batt.position.set(0, -0.17, 0.1);
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.04, 14), steel);
    chuck.rotation.x = Math.PI / 2;
    chuck.position.z = -0.045;
    const loaded = new THREE.Mesh(new THREE.CylinderGeometry(0.00125, 0.00125, WIRE_LEN / 1000, 8), steel);
    loaded.rotation.x = Math.PI / 2;
    loaded.position.z = -0.065 - WIRE_LEN / 2000;
    drill.add(body, handle, batt, chuck, loaded);
    this.drill = drill;
    this.drillWire = loaded;
    this.drillMat = body.material;
    this.drillGrip = new THREE.Vector3(0, -0.09, 0.1);   // where the hand holds it
  }

  placeMeshes() {
    const g = this.guideMesh;
    g.matrix.copy(this.frame);
    g.matrixWorldNeedsUpdate = true;
    g.visible = this.guide.placed;
    const w = this.wire;
    this.wireMesh.visible = w.inGuide;
    if (w.inGuide) {
      const mid = this.E.clone().addScaledVector(this.w, w.depth - WIRE_LEN / 2);
      this.wireMesh.position.copy(mid);
      this.wireMesh.quaternion.setFromUnitVectors(UPV, this.w);
    }
    this.drillWire.visible = !w.inGuide;
  }

  // ---------- state changes ----------
  get wireInBone() { return this.wire.inGuide && this.wire.depth > 0; }

  placeGuide(params = {}) {
    if (this.wireInBone) { this.status = 'Withdraw the wire before moving the guide.'; return false; }
    Object.assign(this.guide, params, { placed: true });
    this.computeGuide();
    return true;
  }

  removeGuide() {
    if (this.wireInBone) { this.status = 'Withdraw the wire first.'; return; }
    this.guide.placed = false;
    this.wire.inGuide = false;
    this.wire.depth = -BARREL;
    this.placeMeshes();
  }

  insertWire() {
    if (!this.guide.placed) { this.status = 'Place the angle guide first.'; return false; }
    if (!this.wire.inGuide) { this.wire.inGuide = true; this.wire.depth = -BARREL; this.placeMeshes(); }
    return true;
  }

  removeWire() {
    this.wire.inGuide = false;
    this.wire.depth = -BARREL;
    this.perforated = false;
    this.blocked = false;
    this.sim.pinned = false;
    this.placeMeshes();
  }

  // ---------- drilling ----------
  /** wire tip in the distal-fragment rest frame and in the patient frame */
  tipRest(out = new THREE.Vector3()) { return out.copy(this.E).addScaledVector(this.w, this.wire.depth); }
  tipPatient(out = new THREE.Vector3()) { return this.tipRest(out).applyMatrix4(this.view.mD); }

  /** CT value (HU) at a rest-frame point of a fragment, nearest voxel */
  huAt(p) {
    const vm = this.meta.volume, [nx, ny, nz] = vm.dims, sp = vm.spacing;
    const i = Math.floor((p.x - vm.corner[0]) / sp), j = Math.floor((p.y - vm.corner[1]) / sp), k = Math.floor((p.z - vm.corner[2]) / sp);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1000;
    const n = i + nx * (j + ny * k);
    return this.volume.base[n] * 12 - 1000 + this.volume.excess[n] * 12;
  }

  /** where the tip is: 'out', 'distal', 'proximal'; plus bone density and head position */
  tipInfo() {
    const tipD = this.tipRest();
    const inD = this.sim.sdfD.sample(tipD) < 0;
    const tipW = tipD.clone().applyMatrix4(this.view.mD);
    const tipP = tipW.clone().applyMatrix4(this.view.mP.clone().invert());
    const dP = this.sim.sdfP.sample(tipP);
    const where = dP < 0 ? 'proximal' : inD ? 'distal' : 'out';
    const hu = where === 'proximal' ? this.huAt(tipP) : where === 'distal' ? this.huAt(tipD) : -100;
    const H = this.sim.H, r = this.meta.landmarks.headRadius;
    const toHead = this.sim.neckLat.clone().negate();
    const rel = tipP.clone().sub(H);
    const beyondHead = rel.dot(toHead) > 0 && rel.length() > r - 1.0 && dP > 0;
    return { where, hu, tipP, beyondHead, distToCentre: rel.length() };
  }

  /** advance (+) or withdraw (-) the wire by up to `amount` mm; returns the bone load 0..1 */
  drive(amount) {
    const w = this.wire;
    if (!w.inGuide) return 0;
    const before = w.depth;
    let load = 0;
    if (amount > 0) {
      const info = this.tipInfo();
      load = Math.max(0, Math.min(1, (info.hu - 100) / 900));
      if (info.beyondHead) {
        if (!this.perforated) { this.perforated = true; this.sounds.warn(); }
        if (info.distToCentre > this.meta.landmarks.headRadius + 7) { this.blocked = true; return 1; } // stopped by the acetabulum
      }
      w.depth = Math.min(150, w.depth + amount);
    } else {
      w.depth = Math.max(-BARREL - 5, w.depth + amount);
      this.blocked = false;
      const info = this.tipInfo();
      if (!info.beyondHead) this.perforated = false;
      if (w.depth < -BARREL) { this.removeWire(); this.status = 'Wire withdrawn completely.'; return 0; }
    }
    if (before <= 2 && w.depth > 2) this.passes++;
    this.lastLoad = load;
    this.updatePin();
    this.placeMeshes();
    return load;
  }

  /** drilling speed (mm/s) for the bone at the tip */
  speed() {
    const hu = this.wire.inGuide && this.wire.depth > -2 ? this.tipInfo().hu : -100;
    this.lastHU = hu;
    if (hu > 800) return 2.5;   // cortical bone
    if (hu > 350) return 5;
    if (hu > 100) return 9;     // cancellous bone
    return 18;                  // soft tissue, fat, marrow
  }

  updatePin() {
    // the wire holds the reduction once it is across the fracture
    this.sim.pinned = this.wire.inGuide && this.crossesFracture() &&
      (this.tipInfo().where === 'proximal' || this.perforated);
  }

  crossesFracture() {
    const n = this.sim.fxNormal, p0 = this.sim.fxPoint;
    return this.tipRest().sub(p0).dot(n) > 0;
  }

  // ---------- metal for the X-ray (patient frame, mm) ----------
  metal(out) {
    const mD = this.view.mD;
    const T = p => p.clone().applyMatrix4(mD);
    if (this.guide.placed) {
      const F = this.frame.clone().premultiply(mD);
      const gl = this.guideGeomLocal;
      const c = gl.plateC.clone().applyMatrix4(F);
      const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
      F.extractBasis(ax, ay, az);
      out.box.push({ c, h: gl.plateH, R: new THREE.Matrix3().set(ax.x, ax.y, ax.z, ay.x, ay.y, ay.z, az.x, az.y, az.z), mu: 0.9 });
      out.cyl.push({ a: new THREE.Vector3().applyMatrix4(F), b: gl.outDir.clone().multiplyScalar(BARREL).applyMatrix4(F), r: 5, mu: 0.35 });
      out.cyl.push({ a: gl.rodA.clone().applyMatrix4(F), b: gl.rodB.clone().applyMatrix4(F), r: 4, mu: 0.9 });
    }
    if (this.wire.inGuide) {
      const tip = this.tipRest();
      out.cyl.push({ a: T(tip), b: T(tip.clone().addScaledVector(this.w, -WIRE_LEN)), r: WIRE_R, mu: 0.9 });
    }
    return out;
  }

  // ---------- VR handling ----------
  /** world position of the guide grip when placed (for grabbing) */
  gripRest() { return this.guideGeomLocal.rodB.clone().applyMatrix4(this.frame); }

  /** live status line */
  statusText() {
    if (!this.guide.placed) return 'Place the 135° angle guide on the lateral cortex.';
    if (!this.wire.inGuide) return 'Angle guide on. Load the guidewire and drill.';
    const d = this.wire.depth;
    if (d <= 0) return `Wire in the guide sleeve (${(-d).toFixed(0)} mm to the bone).`;
    const where = { distal: 'shaft / trochanter', proximal: 'head-neck fragment', out: 'outside bone' }[this.tipInfo().where];
    let t = `Wire ${d.toFixed(0)} mm into bone — tip in ${where}`;
    if (this.perforated) t += ' — HEAD PERFORATED!';
    else if (this.sim.pinned) t += ' · fracture held by the wire';
    return t;
  }

  /** hand-held guide near the thigh: snap to the lateral cortex, slide with the hand */
  guideFromHand(handPatient) {
    // The hand holds the grip of the guide: 150 mm distal of the plate along the shaft and 48 mm out along
    // the guide's own lateral direction. So the grip minus 150 mm along the shaft lies exactly on the
    // guide's lateral line through the shaft centre: that gives the rotation and the height directly.
    const a = this.a;
    const hand = handPatient.clone().applyMatrix4(this.view.mD.clone().invert()); // distal-fragment rest frame
    const t0 = new THREE.Vector3().crossVectors(a, this.l0);
    if (t0.y < 0) t0.negate();
    const q = hand.addScaledVector(a, -150);
    const h = q.clone().sub(this.heightRef).dot(a);
    const rel = q.sub(this.centreAt(h));
    const radial = rel.addScaledVector(a, -rel.dot(a));
    const rot = Math.atan2(-radial.dot(t0), radial.dot(this.l0)) / D2R; // posterior = + anteversion
    const lateralDist = radial.length() - 48;                            // plate distance from the shaft centre
    return { h: Math.max(-30, Math.min(40, h)), rot: Math.max(-20, Math.min(55, rot)), lateralDist };
  }


}

function cylBetween(a, b, r, mat) {
  const d = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UPV, d.normalize());
  return m;
}

export { BARREL, TABLE_TOP };
