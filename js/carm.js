// Mobile C-arm: geometry, AP/lateral poses and the X-ray projection geometry for the DRR.
import * as THREE from 'three';

export const SID = 1.0;   // source-to-image distance (m)
export const SOD = 0.62;  // source-to-isocentre distance (m)
export const DET_R = 0.15; // image intensifier radius (12 inch)
const C_R = 0.72;          // radius of the C
const UP = new THREE.Vector3(0, 1, 0);

const smooth = t => t * t * (3 - 2 * t);

// C-arm angle from AP (0) towards the true lateral (90°). The anteromedial oblique view is the
// true lateral rotated 30° back towards AP (Chen, Chang et al., BMC Musculoskelet Disord 2020;21:719).
export const VIEW_ALPHA = { AP: 0, OBL: Math.PI / 3, LAT: Math.PI / 2 };

export class CArm {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'c-arm';
    const white = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.45 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x59636a, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.4 });

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
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), grey);
    bracket.position.set(0.05, C_R - 0.04, 0);
    const bracket2 = bracket.clone();
    bracket2.position.set(0.05, -C_R + 0.04, 0);
    // aiming laser line (thin, shows the central beam)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, SID - 0.2, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.55 }));
    beam.position.y = -SOD + 0.15 + (SID - 0.2) / 2 - 0.02;
    this.beam = beam;
    beam.visible = false;
    this.c.add(arc, tube, coll, ii, face, bracket, bracket2, beam);
    this.root.add(this.c);

    // fixed support: sleeve, horizontal arm, column and wheeled base
    this.support = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.24), grey);
    const armLen = 0.5;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.12, 0.13), white);
    arm.position.x = 0.09 + armLen / 2;
    this.column = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.24), white);
    this.base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.6), white);
    this.support.add(sleeve, arm, this.column, this.base);
    this.armLen = armLen;
    this.root.add(this.support);

    this.alpha = 0;     // 0 = AP, PI/2 = lateral
    this.anim = null;
    this.view = 'AP';
  }

  /** Recompute poses from the patient anatomy (call after side change). */
  configure(patient) {
    const L = patient.meta.landmarks;
    const hc = new THREE.Vector3().fromArray(L.headCenter);
    const neckLat = new THREE.Vector3().fromArray(L.neckAxisLateral);
    const isoL = hc.clone().addScaledVector(neckLat, L.headRadius + 12);
    this.iso = patient.toWorld(isoL);
    const lateralW = patient.dirToWorld(new THREE.Vector3(-1, 0, 0));
    // neck direction towards the head, flattened to the horizontal plane
    const nm = patient.dirToWorld(neckLat.clone().negate());
    nm.y = 0; nm.normalize();
    let dLat = new THREE.Vector3(nm.z, 0, -nm.x);
    if (dLat.dot(lateralW) < 0) dLat.negate();
    this.dLat = dLat;                         // superolateral, horizontal
    this.hIm = dLat.clone().negate();          // inferomedial, horizontal
    this.nm = nm;
    this.side = patient.side;

    // support: sleeve where the back of the C sits in the AP pose
    const sleeve = this.iso.clone().addScaledVector(this.hIm, C_R);
    const sx = this.hIm.clone(), sz = new THREE.Vector3().crossVectors(sx, UP);
    this.support.matrixAutoUpdate = false;
    this.support.matrix.makeBasis(sx, UP, sz).setPosition(sleeve);
    this.support.matrixWorldNeedsUpdate = true;
    const h = sleeve.y;
    this.column.scale.y = h - 0.2;
    this.column.position.set(0.09 + this.armLen + 0.1, -(h - 0.2) / 2, 0);
    this.base.position.set(0.09 + this.armLen + 0.1, -h + 0.14, 0);
    this.applyPose(this.alpha);
  }

  pose(alpha) {
    const d = UP.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(this.dLat, Math.sin(alpha));
    const b = this.hIm.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(UP, Math.sin(alpha));
    return { d, b };
  }

  applyPose(alpha) {
    const { d, b } = this.pose(alpha);
    const z = new THREE.Vector3().crossVectors(b, d);
    this.c.matrixAutoUpdate = false;
    this.c.matrix.makeBasis(b, d, z).setPosition(this.iso);
    this.c.matrixWorldNeedsUpdate = true;
  }

  /** Swing to a view. Calls done() when the C-arm is in position. */
  moveTo(view, done) {
    const to = VIEW_ALPHA[view];
    this.view = view;
    if (Math.abs(to - this.alpha) < 1e-4) { this.anim = null; done && done(); return; }
    this.anim = { from: this.alpha, to, t: 0, dur: 1.0 + Math.abs(to - this.alpha) * 0.4, done };
  }

  update(dt) {
    if (!this.anim) return;
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / a.dur);
    this.alpha = a.from + (a.to - a.from) * smooth(a.t);
    this.applyPose(this.alpha);
    if (a.t >= 1) { this.anim = null; a.done && a.done(); }
  }

  /** World-space projection geometry for a view (used by the DRR). */
  projection(view) {
    const alpha = VIEW_ALPHA[view];
    const { d } = this.pose(alpha);
    const src = this.iso.clone().addScaledVector(d, -SOD);
    const det = this.iso.clone().addScaledVector(d, SID - SOD);
    let u, v;
    if (view !== 'AP') {
      // lateral and oblique: anterior up, femoral head on the same side as on the AP image
      v = UP.clone().addScaledVector(d, -UP.dot(d)).normalize();
      u = this.side === 'right' ? this.nm.clone() : this.nm.clone().negate();
    } else {
      u = new THREE.Vector3(1, 0, 0);   // patient's left on the viewer's right
      v = new THREE.Vector3(0, 0, -1);  // head up
    }
    return { src, det, u, v, radius: DET_R };
  }
}
