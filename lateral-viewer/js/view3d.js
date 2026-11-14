// 3D bone model from the same CT: pelvis, both fragments of the operated femur, the opposite (lifted) femur,
// and the X-ray beam of the C-arm. Everything is in the patient frame (mm): +x left, +y anterior (up), +z inferior.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BONE = 0xe9dfc8, PROX = 0xf08a3c, DIST = 0x4f9be8;

export class View3D {
  constructor(renderer, canvas, gltf, meta) {
    this.renderer = renderer;
    this.meta = meta;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x15191d);
    this.camera = new THREE.PerspectiveCamera(35, 1, 5, 8000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.8;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404850, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-300, 600, -400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(400, 200, 500);
    this.scene.add(fill);
    this.camera.add(new THREE.DirectionalLight(0xffffff, 0.5));
    this.scene.add(this.camera);

    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0.0 });
    this.mats = { bone: mat(BONE), prox: mat(BONE), dist: mat(BONE) };
    this.P = new THREE.Group();
    this.D = new THREE.Group();
    for (const g of [this.P, this.D]) { g.matrixAutoUpdate = false; this.scene.add(g); }
    const byName = {};
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      byName[o.name] = o;
      if (o.parent && o.parent.name) byName[o.parent.name] = o; // gltfpack keeps the name on the node
    });
    const add = (name, parent, m) => {
      const o = byName[name];
      if (!o) return;
      o.updateWorldMatrix(true, false);
      const mesh = new THREE.Mesh(o.geometry, m);
      mesh.applyMatrix4(o.matrixWorld);
      mesh.geometry.computeVertexNormals();
      parent.add(mesh);
    };
    this.byName = byName;
    add('pelvis', this.scene, this.mats.bone);
    add('femur_contra', this.scene, this.mats.bone);
    add('femur_prox', this.P, this.mats.prox);
    add('femur_dist', this.D, this.mats.dist);
    this.buildBeam();
    this.iso = new THREE.Vector3().fromArray(meta.carm.iso);
    this.controls.target.copy(this.iso);
    this.freeView();
  }

  buildBeam() {
    const C = this.meta.carm;
    this.beam = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(C.detR, C.SID, 48, 1, true);
    coneGeo.translate(0, -C.SID / 2, 0); // apex at the origin (source), opening along -y
    coneGeo.rotateX(Math.PI / 2);         // opening along -z (the beam direction after lookAt)
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
    }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(C.detR - 3, C.detR + 3, 64),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.position.z = -C.SID;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(C.detR, 64),
      new THREE.MeshBasicMaterial({ color: 0x8aa4b8, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    disc.position.z = -C.SID;
    const src = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc040 }));
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -C.SID)]),
      new THREE.LineBasicMaterial({ color: 0xffd060 }));
    this.beam.add(this.cone, ring, disc, src, ray);
    this.scene.add(this.beam);
    this.beamParts = [this.cone, disc, src, ray]; // hidden while looking along the beam (only the field ring stays)
    this.controls.addEventListener('start', () => this.showBeamParts(true));
  }

  /** Vertex positions (patient frame) of a mesh from bones.glb. */
  vertices(name) {
    const o = this.byName[name];
    const pos = o.geometry.attributes.position, v = new THREE.Vector3(), out = [];
    for (let i = 0; i < pos.count; i++) out.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
    return out;
  }

  showBeamParts(v) { for (const o of this.beamParts) o.visible = v; }

  /** Place the beam: source position and unit direction (patient frame). */
  setBeam(src, dir, up) {
    this.beam.position.copy(src);
    const m = new THREE.Matrix4().lookAt(src, src.clone().add(dir), up); // object -z looks along dir
    this.beam.quaternion.setFromRotationMatrix(m);
    this.beamState = { src: src.clone(), dir: dir.clone(), up: up.clone() };
  }

  setBeamVisible(v) { this.beam.visible = v; }

  setFragments(Mp, Md) {
    this.P.matrix.copy(Mp); this.P.matrixWorldNeedsUpdate = true;
    this.D.matrix.copy(Md); this.D.matrixWorldNeedsUpdate = true;
  }

  setColours(on) {
    this.mats.prox.color.setHex(on ? PROX : BONE);
    this.mats.dist.color.setHex(on ? DIST : BONE);
  }

  setSeeThrough(which) {
    for (const k of ['prox', 'dist']) {
      const m = this.mats[k], see = which === k;
      m.transparent = see; m.opacity = see ? 0.28 : 1; m.depthWrite = !see; m.needsUpdate = true;
    }
  }

  freeView() {
    this.showBeamParts(true);
    const t = this.iso;
    this.setUp(new THREE.Vector3(0, 1, 0));
    this.camera.fov = 35;
    this.camera.position.set(t.x - 330, t.y + 300, t.z + 270);
    this.controls.target.copy(t);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Look along the beam, with the same orientation as the X-ray image (rightward = image right, up = image up). */
  beamView(geom) {
    const C = this.meta.carm;
    const d = geom.dir.clone().normalize(), V = geom.V.clone().normalize(), U = geom.U.clone().normalize();
    const fromSource = new THREE.Vector3().crossVectors(d, V).dot(U) > 0;
    const look = fromSource ? d : d.clone().negate();
    this.setUp(V);
    this.showBeamParts(false);
    this.camera.position.copy(this.iso).addScaledVector(look, -C.SOD);   // at the X-ray source (or facing it)
    this.camera.fov = 2 * Math.atan(C.detR / C.SID) * 180 / Math.PI * 1.08;
    this.controls.target.copy(this.iso);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.iso);
    this.controls.update();
  }

  /** Change the camera's up direction; OrbitControls keeps its own copy, so update that too. */
  setUp(up) {
    this.camera.up.copy(up);
    const c = this.controls;
    if (c._quat) {
      c._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
      c._quatInverse.copy(c._quat).invert();
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
