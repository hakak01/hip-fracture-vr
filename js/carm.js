// Mobile C-arm with real movements. The X-ray image is always computed from where the C-arm is.
//
// Movements (all about the isocentre, which starts in the middle of the femoral neck):
//   orbit   AP (0°) <-> true lateral of the neck (90°); the C slides in its sleeve
//   tilt    rotation of the C about the horizontal arm ("angular" / cranio-caudal tilt)
//   wig     wig-wag: swing of the C about the vertical
//   up / head / med   moving the whole C-arm (mm): up-down, towards the head-foot, towards the midline
// The 30° anteromedial oblique is the true lateral rotated 30° back towards AP
// (Chen SY, Chang SM et al. BMC Musculoskelet Disord 2020;21:719).
import * as THREE from 'three';

export const SID = 1.0;    // source-to-image distance (m)
export const SOD = 0.62;   // source-to-isocentre distance (m)
export const DET_R = 0.15; // image intensifier radius (12 inch)
const C_R = 0.72;          // radius of the C
const UP = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;
const smooth = t => t * t * (3 - 2 * t);

export const LIMITS = {
  orbit: [-15, 105], tilt: [-35, 35], wig: [-35, 35],
  up: [-120, 120], head: [-150, 150], med: [-120, 120],
};
export const PRESETS = {
  AP: { orbit: 0, tilt: 0, wig: 0 },
  OBL: { orbit: 60, tilt: 0, wig: 0 },
  LAT: { orbit: 90, tilt: 0, wig: 0 },
};
const clamp = (k, v) => Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));

export class CArm {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'c-arm';
    const white = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.45 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x59636a, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.4 });
    this.handleMat = new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.5 });
    this.handleMat2 = new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.5 });

    // the C itself, in a frame where +Y is the beam and +X is the back of the C
    this.c = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(C_R, 0.045, 10, 48, Math.PI), white);
    arc.rotation.z = -Math.PI / 2;
    arc.scale.z = 1.6;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.26), white);
    tube.position.y = -SOD - 0.01;
    const coll = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), grey);
    coll.position.y = -SOD + 0.13;
    const ii = new THREE.Mesh(new THREE.CylinderGeometry(DET_R + 0.02, DET_R + 0.04, 0.26, 40), white);
    ii.position.y = SID - SOD + 0.13;
    const face = new THREE.Mesh(new THREE.CircleGeometry(DET_R + 0.015, 40), dark);
    face.rotation.x = Math.PI / 2;
    face.position.y = SID - SOD - 0.001;
    // handle ring around the image intensifier (grab it to rotate the C)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(DET_R + 0.055, 0.012, 8, 40), this.handleMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = SID - SOD + 0.08;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), grey);
    bracket.position.set(0.05, C_R - 0.04, 0);
    const bracket2 = bracket.clone();
    bracket2.position.set(0.05, -C_R + 0.04, 0);
    // central beam (shown red while the X-ray is on)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, SID - 0.2, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.55 }));
    beam.position.y = -SOD + 0.15 + (SID - 0.2) / 2 - 0.02;
    this.beam = beam;
    beam.visible = false;
    this.c.add(arc, tube, coll, ii, face, ring, bracket, bracket2, beam);
    this.c.matrixAutoUpdate = false;
    this.root.add(this.c);
    this.iiHandleLocal = new THREE.Vector3(0, SID - SOD + 0.08, 0);

    // support: sleeve, horizontal arm with a steering handle, column and wheeled base
    this.support = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.24), grey);
    const armLen = 0.5;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.12, 0.13), white);
    arm.position.x = 0.09 + armLen / 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 12), this.handleMat2);
    bar.position.set(0.32, 0.14, 0);
    bar.rotation.x = Math.PI / 2;
    const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), grey);
    post1.position.set(0.32, 0.09, 0.14);
    const post2 = post1.clone(); post2.position.z = -0.14;
    this.column = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.24), white);
    this.base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.6), white);
    this.support.add(sleeve, arm, bar, post1, post2, this.column, this.base);
    this.support.matrixAutoUpdate = false;
    this.armLen = armLen;
    this.barLocal = new THREE.Vector3(0.32, 0.14, 0);
    this.root.add(this.support);

    // laser cross where the central beam meets the patient
    const lmat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, depthTest: false });
    this.laser = new THREE.Group();
    const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.0018), lmat);
    const l2 = new THREE.Mesh(new THREE.PlaneGeometry(0.0018, 0.09), lmat);
    this.laser.add(l1, l2);
    this.laser.renderOrder = 5;
    this.laser.visible = false;
    this.root.add(this.laser);
    this.laserOn = true;

    this.state = { orbit: 0, tilt: 0, wig: 0, up: 0, head: 0, med: 0 };
    this.anim = null;
    this.version = 0; // increases whenever the pose changes
  }

  /** Recompute the frame from the patient anatomy (call after a side change). */
  configure(patient) {
    const L = patient.meta.landmarks;
    const hc = new THREE.Vector3().fromArray(L.headCenter);
    const neckLat = new THREE.Vector3().fromArray(L.neckAxisLateral);
    this.isoBase = patient.toWorld(hc.clone().addScaledVector(neckLat, L.headRadius + 12));
    const lateralW = patient.dirToWorld(new THREE.Vector3(-1, 0, 0));
    const nm = patient.dirToWorld(neckLat.clone().negate());
    nm.y = 0; nm.normalize();
    let dLat = new THREE.Vector3(nm.z, 0, -nm.x);
    if (dLat.dot(lateralW) < 0) dLat.negate();
    this.dLat = dLat;                                  // superolateral, horizontal
    this.e1 = dLat.clone().negate();                   // inferomedial, horizontal: towards the C-arm
    this.nC = new THREE.Vector3().crossVectors(this.e1, UP); // normal of the C plane in the AP pose
    this.nm = nm;
    this.side = patient.side;
    this.sideSign = patient.side === 'right' ? 1 : -1;
    this.E = new THREE.Matrix4().makeBasis(this.e1, UP, this.nC);
    this.apply();
  }

  // ---------- pose ----------
  iso(out = new THREE.Vector3()) {
    const s = this.state;
    return out.copy(this.isoBase).add(new THREE.Vector3(this.sideSign * s.med, s.up, -s.head).multiplyScalar(0.001));
  }

  /** rotation of the C (world) from the three angles */
  rotation(out = new THREE.Matrix4()) {
    const s = this.state;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(s.tilt * D2R, s.wig * D2R, s.orbit * D2R, 'YXZ'));
    return out.copy(this.E).multiply(m).multiply(this.E.clone().transpose());
  }

  /** beam direction d (source -> detector) and back of the C, b */
  axes() {
    const R = this.rotation();
    const d = UP.clone().applyMatrix4(R).normalize();
    const b = this.e1.clone().applyMatrix4(R).normalize();
    return { d, b, R };
  }

  apply() {
    const { d, b } = this.axes();
    const iso = this.iso();
    const z = new THREE.Vector3().crossVectors(b, d);
    this.c.matrix.makeBasis(b, d, z).setPosition(iso);
    this.c.matrixWorldNeedsUpdate = true;
    // support follows the translation and wig-wag; the C slides through the sleeve (orbit)
    // and turns about the arm (tilt), so the sleeve stays where it is
    const Rw = new THREE.Matrix4().makeRotationAxis(UP, this.state.wig * D2R);
    const sx = this.e1.clone().applyMatrix4(Rw), sz = new THREE.Vector3().crossVectors(sx, UP);
    const sleeve = iso.clone().addScaledVector(sx, C_R);
    this.support.matrix.makeBasis(sx, UP, sz).setPosition(sleeve);
    this.support.matrixWorldNeedsUpdate = true;
    const h = sleeve.y;
    this.column.scale.y = h - 0.2;
    this.column.position.set(0.09 + this.armLen + 0.1, -(h - 0.2) / 2, 0);
    this.base.position.set(0.09 + this.armLen + 0.1, -h + 0.14, 0);
    this.version++;
  }

  set(changes) {
    for (const [k, v] of Object.entries(changes)) if (k in this.state) this.state[k] = clamp(k, v);
    this.anim = null;
    this.apply();
  }

  /** Swing to a preset (keeps the translation). Calls done() when in position. */
  moveTo(view, done) {
    const to = { ...this.state, ...PRESETS[view] };
    const dist = Math.max(...['orbit', 'tilt', 'wig'].map(k => Math.abs(to[k] - this.state[k])));
    if (dist < 0.1) { this.anim = null; done && done(); return; }
    this.anim = { from: { ...this.state }, to, t: 0, dur: 0.8 + dist / 90 * 0.9, done };
  }

  /** Move to an exact state (e.g. after "Centre on wire"). */
  moveToState(target, done) {
    this.anim = { from: { ...this.state }, to: { ...this.state, ...target }, t: 0, dur: 0.9, done };
  }

  update(dt) {
    if (!this.anim) return;
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / a.dur);
    const k = smooth(a.t);
    for (const key of Object.keys(this.state)) this.state[key] = a.from[key] + (a.to[key] - a.from[key]) * k;
    this.apply();
    if (a.t >= 1) { this.anim = null; a.done && a.done(); }
  }

  /** Which monitor screen an image from the current position goes to. */
  screen() { return this.state.orbit < 45 ? 'AP' : 'LAT'; }

  /** Short name for the image overlay. */
  viewName() {
    const s = this.state, near = (a, b) => Math.abs(a - b) < 2.5;
    const straight = near(s.tilt, 0) && near(s.wig, 0);
    if (straight && near(s.orbit, 0)) return 'AP';
    if (straight && near(s.orbit, 90)) return 'LAT';
    if (straight && near(s.orbit, 60)) return 'OBL 30°';
    return this.screen() === 'AP' ? 'AP*' : 'LAT*';
  }

  angleText() {
    const s = this.state;
    return `ORB ${s.orbit.toFixed(0)}°  TILT ${s.tilt.toFixed(0)}°  WIG ${s.wig.toFixed(0)}°`;
  }

  /** World-space projection geometry for the current position (used by the DRR). */
  projection() {
    const { d } = this.axes();
    const iso = this.iso();
    const src = iso.clone().addScaledVector(d, -SOD);
    const det = iso.clone().addScaledVector(d, SID - SOD);
    // display orientation: AP screen = head up, patient's left on the right;
    // lateral screen = anterior up, femoral head towards the same side as on the AP
    const screen = this.screen();
    const hint = screen === 'AP' ? new THREE.Vector3(0, 0, -1) : UP.clone();
    const v = hint.addScaledVector(d, -hint.dot(d)).normalize();
    const u = screen === 'AP' ? new THREE.Vector3().crossVectors(v, d) : new THREE.Vector3().crossVectors(d, v);
    return { src, det, u: u.normalize(), v, radius: DET_R, screen };
  }

  // ---------- hands-on control (VR) ----------
  /** grab the ring on the image intensifier: the C rotates about the isocentre to follow the hand */
  grabRing(handPos) {
    const iso = this.iso();
    const ring = this.iiHandleLocal.clone().applyMatrix4(this.c.matrix);
    this.grab = { mode: 'ring', iso, offset: handPos.clone().sub(ring), v0: ring.sub(iso).normalize(), R0: this.rotation() };
    this.anim = null;
  }

  /** grab the steering bar on the arm: the whole C-arm moves with the hand */
  grabBar(handPos) {
    this.grab = { mode: 'bar', h0: handPos.clone(), s0: { ...this.state } };
    this.anim = null;
  }

  dragTo(handPos) {
    const g = this.grab;
    if (!g) return;
    if (g.mode === 'bar') {
      const d = handPos.clone().sub(g.h0).multiplyScalar(1000);
      this.set({ up: g.s0.up + d.y, head: g.s0.head - d.z, med: g.s0.med + this.sideSign * d.x });
      return;
    }
    const v1 = handPos.clone().sub(g.offset).sub(g.iso);
    if (v1.lengthSq() < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(g.v0, v1.normalize());
    const R = new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(g.R0);
    // back to the three angles: R = E * Ry(wig) Rx(tilt) Rz(orbit) * E^T
    const local = this.E.clone().transpose().multiply(R).multiply(this.E);
    const e = new THREE.Euler().setFromRotationMatrix(local, 'YXZ');
    this.set({ orbit: e.z / D2R, tilt: e.x / D2R, wig: e.y / D2R });
  }

  release() { this.grab = null; }

  ringWorld(out = new THREE.Vector3()) { return out.copy(this.iiHandleLocal).applyMatrix4(this.c.matrix); }
  barWorld(out = new THREE.Vector3()) { return out.copy(this.barLocal).applyMatrix4(this.support.matrix); }

  highlight(which, on) {
    (which === 'ring' ? this.handleMat : this.handleMat2).emissive.setHex(on ? 0x335533 : 0x000000);
  }

  /** place the laser cross on whatever the central beam hits first */
  updateLaser(targets) {
    if (!this.laserOn) { this.laser.visible = false; return; }
    const { d } = this.axes();
    const det = this.iso().addScaledVector(d, SID - SOD);
    const ray = new THREE.Raycaster(det, d.clone().negate(), 0, SID);
    const hit = ray.intersectObjects(targets, false)[0];
    this.laser.visible = !!hit;
    if (!hit) return;
    this.laser.position.copy(hit.point).addScaledVector(d, 0.002);
    this.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().negate());
  }
}
