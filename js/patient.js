// The patient: CT bone and skin meshes in a millimetre "patient frame", mirrored for a left hip.
// Patient frame: +x patient left, +y anterior, +z inferior, origin between the femoral heads.
import * as THREE from 'three';
import { TABLE_TOP } from './room.js';

const WELL_LEG_EXTENSION = THREE.MathUtils.degToRad(24); // contralateral hip dropped down (scissor position)
const WELL_LEG_ABDUCTION = THREE.MathUtils.degToRad(3);

export class Patient {
  constructor(gltf, meta) {
    this.meta = meta;
    const L = meta.landmarks;
    this.root = new THREE.Group();
    this.root.name = 'patient';
    this.root.position.set(0, TABLE_TOP - meta.body.tableY * 0.001, 0);
    this.local = new THREE.Group(); // mm frame
    this.local.scale.setScalar(0.001);
    this.root.add(this.local);

    this.boneMat = new THREE.MeshStandardMaterial({ color: 0xead9b8, roughness: 0.55, metalness: 0.0 });
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xd4a088, roughness: 0.62, metalness: 0.0 });
    this.drapeMat = new THREE.MeshStandardMaterial({ color: 0x2c6f8e, roughness: 0.92, metalness: 0.0 });
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });

    this.local.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    // named nodes (pelvis, femur_op, ...) each hold one mesh (gltfpack adds a dequantisation transform)
    this.parts = {};  // node per name
    this.meshes = {}; // mesh per name
    for (const node of gltf.scene.children) {
      let mesh = null;
      node.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) continue;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
      this.parts[node.name] = node;
      this.meshes[node.name] = mesh;
    }
    for (const n of ['pelvis', 'femur_op', 'femur_contra', 'legbones_op', 'legbones_contra']) {
      if (this.meshes[n]) this.meshes[n].material = this.boneMat;
    }

    // well (contralateral) leg rotates about its femoral head: lowered out of the lateral beam
    this.wellPivot = new THREE.Group();
    this.wellPivot.position.fromArray(L.headCenterContra);
    this.local.add(this.wellPivot);
    this.local.updateMatrixWorld(true);
    for (const n of ['femur_contra', 'legbones_contra', 'well_leg']) {
      if (this.parts[n]) this.wellPivot.attach(this.parts[n]);
    }
    this.wellPivot.rotation.set(WELL_LEG_EXTENSION, WELL_LEG_ABDUCTION, 0, 'YXZ');

    // skin and draped well leg: a depth pre-pass gives clean see-through fading
    this.fadeables = [];
    for (const [name, mat] of [['skin', this.skinMat], ['well_leg', this.drapeMat.clone()]]) {
      const m = this.meshes[name];
      if (!m) continue;
      m.material = mat;
      m.renderOrder = 2;
      const pre = new THREE.Mesh(m.geometry, this.depthMat);
      pre.renderOrder = 1;
      pre.visible = false;
      m.add(pre);
      this.fadeables.push({ mesh: m, pre });
    }

    this.buildDrapes(meta);
    this.setSide('right');
  }

  buildDrapes(meta) {
    const b = meta.body, s = b.topSection;
    const w = (s.xMax - s.xMin) + 50, h = (s.yMax - b.tableY) + 30, len = 950;
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 40, 1);
    const torso = new THREE.Mesh(g, this.drapeMat);
    torso.scale.set(w, len, h);
    torso.rotation.x = Math.PI / 2;
    torso.position.set((s.xMin + s.xMax) / 2, (b.tableY + s.yMax) / 2, b.zTop + 25 - len / 2);
    this.local.add(torso);
    // anaesthetic screen across the chest
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(900, 650), new THREE.MeshStandardMaterial({
      color: 0x2c6f8e, roughness: 0.95, side: THREE.DoubleSide }));
    screen.position.set((s.xMin + s.xMax) / 2, s.yMax + 330, b.zTop - 650);
    this.local.add(screen);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 950, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa4aa, metalness: 0.6, roughness: 0.35 }));
    bar.rotation.z = Math.PI / 2;
    bar.position.set((s.xMin + s.xMax) / 2, s.yMax + 650, b.zTop - 650);
    this.local.add(bar);
  }

  get side() { return this._side; }

  setSide(side) {
    this._side = side;
    this.local.scale.x = side === 'right' ? 0.001 : -0.001;
    this.root.updateMatrixWorld(true);
  }

  setSkin(on, opacity) {
    for (const { mesh, pre } of this.fadeables) {
      const show = on && opacity > 0.02;
      mesh.visible = show;
      const see = opacity < 0.995;
      mesh.material.transparent = see;
      mesh.material.opacity = opacity;
      mesh.material.depthWrite = !see;
      mesh.material.needsUpdate = true;
      pre.visible = show && see;
    }
  }

  /** patient-frame mm point -> world metres */
  toWorld(p, target = new THREE.Vector3()) {
    return target.copy(p).applyMatrix4(this.local.matrixWorld);
  }

  /** patient-frame direction -> unit world direction */
  dirToWorld(d, target = new THREE.Vector3()) {
    return target.copy(d).transformDirection(this.local.matrixWorld);
  }

  /** world point (m) -> patient frame (mm) */
  toLocal(p, target = new THREE.Vector3()) {
    return target.copy(p).applyMatrix4(this.local.matrixWorld.clone().invert());
  }

  /** world position of the lowered calf (for the leg holder) */
  wellCalfWorld() {
    const L = this.meta.landmarks;
    const knee = new THREE.Vector3().fromArray(L.kneeCenterContra);
    const hc = new THREE.Vector3().fromArray(L.headCenterContra);
    const shaft = knee.clone().sub(hc).normalize();
    const p = knee.clone().addScaledVector(shaft, 160).sub(hc); // 16 cm below the knee, relative to pivot
    p.applyMatrix4(this.wellPivot.matrixWorld);
    return p;
  }
}
