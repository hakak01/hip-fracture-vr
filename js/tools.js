// Hand-held instruments for VR: a ball spike pusher and a bone lever, on an instrument tray.
// Pick one up with the grip button (or a pinch); its tip pushes bone fragments it touches.
import * as THREE from 'three';
import { TABLE_TOP } from './room.js';

function cyl(r, len, mat, z0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
  m.rotation.x = Math.PI / 2;      // along -z when held
  m.position.z = z0 - len / 2;
  return m;
}

function makeTool(kind) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd6db, metalness: 0.85, roughness: 0.25 });
  const grip = new THREE.MeshStandardMaterial({ color: kind === 'spike' ? 0x2d6fb0 : 0x3f8a55, roughness: 0.55 });
  g.add(cyl(0.016, 0.12, grip, 0.06));
  g.add(cyl(0.0035, 0.22, steel, -0.06));
  let tip, radius;
  if (kind === 'spike') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 16, 12), steel);
    ball.position.z = -0.285;
    g.add(ball);
    tip = new THREE.Vector3(0, 0, -0.285);
    radius = 5.5;
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.035), steel);
    blade.position.set(0, -0.006, -0.29);
    blade.rotation.x = 0.35;
    g.add(blade);
    tip = new THREE.Vector3(0, -0.01, -0.305);
    radius = 8;
  }
  return { kind, group: g, tip, radius, grip, held: false };
}

export class Tools {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'instruments';
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.56),
      new THREE.MeshStandardMaterial({ color: 0xb7c2c8, metalness: 0.6, roughness: 0.35 }));
    top.position.y = TABLE_TOP;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, TABLE_TOP),
      new THREE.MeshStandardMaterial({ color: 0x9aa4aa, metalness: 0.6, roughness: 0.35 }));
    leg.position.y = TABLE_TOP / 2;
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.004, 0.5), new THREE.MeshStandardMaterial({ color: 0x2c6f8e, roughness: 0.95 }));
    towel.position.y = TABLE_TOP + 0.012;
    this.tray = new THREE.Group();
    this.tray.add(top, leg, towel);
    this.root.add(this.tray);
    this.items = [makeTool('spike'), makeTool('lever')];
    for (const it of this.items) this.root.add(it.group);
    this.place(1);
  }

  /** tray beside the surgeon, towards the foot end */
  place(sideSign) {
    this.tray.position.set(-0.78 * sideSign, 0, 0.42);
    this.items.forEach((it, i) => {
      it.home = {
        pos: new THREE.Vector3(-0.78 * sideSign + (i ? 0.06 : -0.06), TABLE_TOP + 0.03, 0.42 + 0.1),
        quat: new THREE.Quaternion(), // lying along the tray, tip towards the head end
      };
      if (!it.held) this.goHome(it);
    });
  }

  goHome(it) {
    it.held = false;
    it.group.position.copy(it.home.pos);
    it.group.quaternion.copy(it.home.quat);
  }

  /** grabbable descriptions for the VR system */
  grabbables() {
    return this.items.map(it => ({
      id: it.kind,
      radius: 0.1,
      worldPos: (out = new THREE.Vector3()) => it.group.getWorldPosition(out),
      grab: () => { it.held = true; },
      move: pose => { it.group.position.copy(pose.pos); it.group.quaternion.copy(pose.quat); },
      release: () => this.goHome(it),
      highlight: on => it.grip.emissive.setHex(on ? 0x335533 : 0x000000),
    }));
  }

  /** tips of the instruments in hand, in the patient frame (mm), for the physics */
  tips(patient) {
    const out = [];
    for (const it of this.items) {
      if (!it.held) continue;
      it.group.updateMatrixWorld();
      const w = it.tip.clone().applyMatrix4(it.group.matrixWorld);
      out.push({ tip: patient.toLocal(w), radius: it.radius });
    }
    return out;
  }
}
