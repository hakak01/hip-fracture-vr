// Shows the physics: fragment meshes, Schanz pin, traction boot, muscle lines (coloured by stretch)
// and a skin that follows the leg. Everything here lives in the patient frame (mm).
import * as THREE from 'three';

const UPV = new THREE.Vector3(0, 1, 0);
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const SLACK = new THREE.Color(0x6f8896);

export function strainColor(e, out = new THREE.Color()) {
  if (e <= 0) return out.copy(SLACK);
  const t = Math.min(1, e / 0.15);         // 0 = just taut (green) ... 15 % stretch = red
  return out.setHSL(0.33 * (1 - t), 0.85, 0.5);
}

export class FractureView {
  constructor(patient, sim) {
    this.patient = patient;
    this.sim = sim;
    const L = sim.meta.landmarks;
    this.P = new THREE.Group();
    this.D = new THREE.Group();
    for (const g of [this.P, this.D]) { g.matrixAutoUpdate = false; patient.local.add(g); }
    patient.local.updateMatrixWorld(true);
    this.P.attach(patient.parts.femur_prox);
    this.D.attach(patient.parts.femur_dist);
    this.D.attach(patient.parts.legbones_op);
    this.steel = new THREE.MeshStandardMaterial({ color: 0xc9d1d6, metalness: 0.85, roughness: 0.25 });
    this.buildPin(L);
    this.buildBoot();
    this.buildMuscles();
    this.setupSkin();
    this.mP = new THREE.Matrix4();
    this.mD = new THREE.Matrix4();
    this.update();
  }

  buildPin(L) {
    const s = this.sim;
    const tip = s.H.clone().addScaledVector(s.neckLat, L.headRadius * 0.9);
    const dir = new THREE.Vector3(-0.25, 1, -0.1).normalize(); // out through the anterior skin
    const len = 175;
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, len, 12), this.steel);
    rod.position.copy(tip).addScaledVector(dir, len / 2);
    rod.quaternion.setFromUnitVectors(UPV, dir);
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 34, 16), this.steel);
    chuck.position.copy(tip).addScaledVector(dir, len - 12);
    chuck.quaternion.copy(rod.quaternion);
    const barDir = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize();
    this.pinGrip = new THREE.MeshStandardMaterial({ color: 0x2d6fb0, roughness: 0.5 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 110, 16), this.pinGrip);
    bar.position.copy(tip).addScaledVector(dir, len + 4);
    bar.quaternion.setFromUnitVectors(UPV, barDir);
    g.add(rod, chuck, bar);
    this.P.add(g);
    this.pinHandle = bar.position.clone(); // rest-frame grab point
    this.pin = g;
  }

  buildBoot() {
    // traction boot over the foot (the foot points downwards and is cut by the scan edge; the boot covers it)
    const s = this.sim, f = s.foot, h = s.heel;
    this.bootMat = new THREE.MeshStandardMaterial({ color: 0x2b3236, roughness: 0.75 });
    const g = new THREE.Group();
    const len = 210, cz = h.z + 55;
    const cy = f.y + 6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(118, 120, len), this.bootMat);
    box.position.set(f.x, cy, cz);
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x8a9298, roughness: 0.6 });
    for (const dz of [-70, -15, 45]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(122, 124, 16), strapMat);
      strap.position.set(f.x, cy, cz + dz);
      g.add(strap);
    }
    // traction bar to the table's traction unit
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 180, 12), this.steel);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(f.x, cy, cz + len / 2 + 90);
    g.add(box, bar);
    this.D.add(g);
    this.footHandle = box.position.clone();
    this.boot = g;
  }

  buildMuscles() {
    this.lineGroup = new THREE.Group();
    this.patient.local.add(this.lineGroup);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geo.translate(0, 0.5, 0);
    const dot = new THREE.SphereGeometry(1, 10, 8);
    this.lineMeshes = this.sim.lines.map(l => {
      const mat = new THREE.MeshBasicMaterial({ color: SLACK });
      const m = new THREE.Mesh(geo, mat);
      const a = new THREE.Mesh(dot, mat);
      const b = new THREE.Mesh(dot, mat);
      a.scale.setScalar(4.5); b.scale.setScalar(4.5);
      a.position.copy(l.origin);
      this.lineGroup.add(m, a, b);
      return { line: l, mesh: m, end: b, mat };
    });
  }

  setupSkin() {
    const f = this.patient.fadeables.find(x => x.name === 'skin');
    if (!f) return;
    const mesh = f.mesh, s = this.sim;
    mesh.frustumCulled = false;
    f.pre.frustumCulled = false;
    this.patient.local.updateMatrixWorld(true);
    this.Mq = new THREE.Matrix4().copy(this.patient.local.matrixWorld).invert().multiply(mesh.matrixWorld);
    this.MqInv = this.Mq.clone().invert();
    const pos = mesh.geometry.attributes.position;
    const w = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    const sLT = s.attach.lt.clone().sub(s.H).dot(s.shaft);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(this.Mq);
      const sd = v.clone().sub(s.H).dot(s.shaft);
      w[i] = smoothstep(sLT - 25, sLT + 100, sd) * smoothstep(20, -30, v.x);
    }
    mesh.geometry.setAttribute('aW', new THREE.BufferAttribute(w, 1));
    this.uDef = { value: new THREE.Matrix4() };
    const inject = mat => {
      mat.onBeforeCompile = sh => {
        sh.uniforms.uDef = this.uDef;
        sh.vertexShader = 'attribute float aW;\nuniform mat4 uDef;\n' + sh.vertexShader
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = normalize(mix(objectNormal, mat3(uDef) * objectNormal, aW));')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = mix(transformed, (uDef * vec4(transformed, 1.0)).xyz, aW);');
      };
      mat.needsUpdate = true;
    };
    inject(mesh.material);
    inject(f.pre.material);
  }

  setMusclesVisible(v) { this.lineGroup.visible = v; }

  /** world position of a rest-frame point on a fragment */
  worldPoint(body, p, out = new THREE.Vector3()) {
    out.copy(p).applyMatrix4(body === 'P' ? this.mP : this.mD);
    return this.patient.toWorld(out, out);
  }

  update() {
    const s = this.sim;
    s.matrixP(this.mP);
    s.matrixD(this.mD);
    this.P.matrix.copy(this.mP);
    this.D.matrix.copy(this.mD);
    this.P.matrixWorldNeedsUpdate = true;
    this.D.matrixWorldNeedsUpdate = true;
    if (this.uDef) this.uDef.value.copy(this.MqInv).multiply(this.mD).multiply(this.Mq);
    if (this.lineGroup.visible) {
      const d = new THREE.Vector3();
      for (const lm of this.lineMeshes) {
        const l = lm.line;
        d.copy(l.x).sub(l.origin);
        const len = d.length();
        lm.mesh.position.copy(l.origin);
        lm.mesh.quaternion.setFromUnitVectors(UPV, d.divideScalar(len));
        lm.mesh.scale.set(2.6, len, 2.6);
        lm.end.position.copy(l.x);
        strainColor(l.strain, lm.mat.color);
      }
    }
  }

  setHighlight(name, on) {
    const mat = name === 'foot' ? this.bootMat : this.pinGrip;
    mat.emissive.setHex(on ? 0x335533 : 0x000000);
  }
}
