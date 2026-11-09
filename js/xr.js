// WebXR: enter/exit VR, controllers and hands, laser pointers for panels, thumbstick movement.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

export async function vrSupported() {
  try {
    return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'));
  } catch (e) {
    return false;
  }
}

export class XRSystem {
  /**
   * @param renderer three.js renderer
   * @param rig Group that holds the camera; moved to walk/turn
   * @param camera the main camera (child of rig)
   * @param getPanels () => array of Panel objects that can be pointed at
   */
  constructor(renderer, rig, camera, getPanels) {
    this.renderer = renderer;
    this.rig = rig;
    this.camera = camera;
    this.getPanels = getPanels;
    this.raycaster = new THREE.Raycaster();
    this.session = null;
    this.snapReady = [true, true];
    this.home = { position: new THREE.Vector3(), yaw: 0 };

    const cmf = new XRControllerModelFactory();
    const hmf = new XRHandModelFactory();
    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const rayMat = new THREE.LineBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.8 });
    const dotGeo = new THREE.SphereGeometry(0.006, 12, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });

    this.controllers = [0, 1].map(i => {
      const ctrl = renderer.xr.getController(i);
      const ray = new THREE.Line(rayGeo, rayMat);
      ray.scale.z = 1.5;
      ctrl.add(ray);
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.visible = false;
      rig.add(dot);
      const state = { ctrl, ray, dot, source: null, hit: null, panel: null };
      ctrl.addEventListener('connected', e => { state.source = e.data; ray.visible = e.data.targetRayMode !== 'screen'; });
      ctrl.addEventListener('disconnected', () => { state.source = null; this.leave(i, state); });
      ctrl.addEventListener('selectstart', () => {
        if (state.hit) state.hit.panel.pointerDown(i, state.hit.uv);
      });
      ctrl.addEventListener('selectend', () => { if (state.panel) state.panel.pointerUp(i); });
      rig.add(ctrl);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(cmf.createControllerModel(grip));
      rig.add(grip);
      const hand = renderer.xr.getHand(i);
      hand.add(hmf.createHandModel(hand, 'mesh'));
      rig.add(hand);
      return state;
    });

    renderer.xr.addEventListener('sessionstart', () => this.onStart && this.onStart());
    renderer.xr.addEventListener('sessionend', () => { this.session = null; this.onEnd && this.onEnd(); });
  }

  async enter() {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    this.session = session;
  }

  exit() {
    if (this.session) this.session.end();
  }

  /** Where the user stands in VR, and which way they face. */
  setHome(position, yaw) {
    this.home.position.copy(position);
    this.home.yaw = yaw;
  }

  goHome() {
    this.rig.position.copy(this.home.position);
    this.rig.rotation.set(0, this.home.yaw, 0);
  }

  leave(i, state) {
    if (state.panel) state.panel.pointerLeave(i);
    state.panel = null;
    state.hit = null;
    state.dot.visible = false;
  }

  update(dt) {
    const panels = this.getPanels().filter(p => p.mesh.visible);
    const meshes = panels.map(p => p.mesh);
    this.controllers.forEach((s, i) => {
      if (!s.source) return;
      this.raycaster.setFromXRController(s.ctrl);
      const hits = this.raycaster.intersectObjects(meshes, false);
      const h = hits[0];
      if (h) {
        const panel = h.object.userData.panel;
        if (s.panel && s.panel !== panel) s.panel.pointerLeave(i);
        s.panel = panel;
        s.hit = { panel, uv: h.uv };
        panel.pointerMove(i, h.uv);
        s.ray.scale.z = h.distance;
        s.dot.visible = true;
        s.dot.position.copy(h.point);
        this.rig.worldToLocal(s.dot.position);
      } else {
        if (s.panel) this.leave(i, s);
        s.ray.scale.z = 1.5;
      }
    });
    this.locomotion(dt);
  }

  locomotion(dt) {
    for (const s of this.controllers) {
      const src = s.source;
      if (!src || !src.gamepad || src.gamepad.axes.length < 4) continue;
      const ax = src.gamepad.axes[2], ay = src.gamepad.axes[3];
      if (src.handedness === 'left') {
        if (Math.abs(ax) + Math.abs(ay) < 0.15) continue;
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const speed = 1.2 * dt;
        this.rig.position.addScaledVector(fwd, -ay * speed).addScaledVector(right, ax * speed);
      } else if (src.handedness === 'right') {
        const k = 1;
        if (Math.abs(ax) > 0.7 && this.snapReady[k]) {
          this.snapReady[k] = false;
          this.snapTurn(ax > 0 ? -Math.PI / 6 : Math.PI / 6);
        } else if (Math.abs(ax) < 0.3) {
          this.snapReady[k] = true;
        }
      }
    }
  }

  snapTurn(angle) {
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    const p = this.rig.position.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(head);
    this.rig.position.copy(p);
    this.rig.rotation.y += angle;
  }
}
