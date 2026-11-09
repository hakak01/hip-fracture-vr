// C-arm monitor cart: two screens (left: AP images, right: lateral and oblique images) and a button strip.
import * as THREE from 'three';
import { Panel } from './panel.js';

export class Monitor {
  constructor(drrCanvases, app) {
    this.root = new THREE.Group();
    this.root.name = 'monitor';
    const white = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4aa, roughness: 0.35, metalness: 0.6 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.6), white);
    base.position.y = 0.12;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.45), steel);
    pole.position.y = 0.9;
    this.root.add(base, pole);

    const S = 0.44; // screen size (m)
    const Y0 = 1.82; // screen centre height (m), above the image intensifier
    const VIEWS = [['AP', 'AP'], ['LAT', 'LATERAL / OBLIQUE']];
    const W = 2 * S + 0.12;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(W, S + 0.1, 0.07), dark);
    housing.position.set(0, Y0, 0);
    this.root.add(housing);

    this.screens = {};
    this.frames = {};
    const labelsY = Y0 + S / 2 + 0.07;
    VIEWS.forEach(([view, title], i) => {
      const x = (i - 0.5) * (S + 0.03);
      const tex = new THREE.CanvasTexture(drrCanvases[view]);
      tex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.set(x, Y0, 0.036);
      scr.userData.view = view;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(S + 0.016, S + 0.016), new THREE.MeshBasicMaterial({ color: 0x15191c }));
      frame.position.set(x, Y0, 0.0355);
      this.root.add(frame, scr);
      this.screens[view] = { mesh: scr, tex };
      this.frames[view] = frame;
      const lbl = makeLabel(title);
      lbl.position.set(x, labelsY, 0.036);
      this.root.add(lbl);
    });
    this.views = VIEWS.map(v => v[0]);

    // button strip under the screens
    this.panel = new Panel({
      width: W, height: 0.13, bg: '#101619f2',
      items: [
        { id: 'ap', type: 'button', x: 14, y: 16, w: 110, h: 98, label: 'AP', size: 36, onPress: () => app.shoot('AP'), active: () => app.state.busy === 'AP' },
        { id: 'lat', type: 'button', x: 132, y: 16, w: 120, h: 98, label: 'LAT', size: 36, onPress: () => app.shoot('LAT'), active: () => app.state.busy === 'LAT' },
        { id: 'obl', type: 'button', x: 260, y: 16, w: 170, h: 98, label: 'OBL 30°', size: 34, onPress: () => app.shoot('OBL'), active: () => app.state.busy === 'OBL' },
        { id: 'xray', type: 'button', x: 438, y: 16, w: 200, h: 98, label: '☢ X-RAY', size: 36, color: '#6b4d10', activeColor: '#c98a10', onPress: () => app.shoot(), active: () => app.state.busy === 'HERE' },
        { id: 'inv', type: 'button', x: 646, y: 16, w: 130, h: 98, label: 'Invert', size: 30, onPress: () => app.toggleInvert(), active: () => app.state.invert },
        { id: 'laser', type: 'button', x: 784, y: 16, w: 120, h: 98, label: 'Laser', size: 30, onPress: () => app.toggleLaser(), active: () => app.state.laser },
        { id: 'rad', type: 'label', x: 912, y: 16, w: 80, h: 98, size: 24, color: '#ffd770', align: 'left', label: () => app.state.busy ? '● ON' : '' },
      ],
    });
    this.panel.mesh.position.set(0, Y0 - S / 2 - 0.13, 0.03);
    this.panel.mesh.rotation.x = -0.25;
    this.root.add(this.panel.mesh);
  }

  imageUpdated(view) {
    this.screens[view].tex.needsUpdate = true;
    for (const v of this.views) this.frames[v].material.color.set(v === view ? 0xffc83a : 0x15191c);
  }

  /** Place across the table from the surgeon, facing them. */
  place(sideSign) {
    this.root.position.set(1.2 * sideSign, 0, 0.8);
    this.root.lookAt(-0.7 * sideSign, 0, 0.05);
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 340; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#9fc6d2'; g.font = '600 32px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 170, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.0375), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
}
