// C-arm monitor cart: two screens (AP and lateral) and a button strip.
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
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2 * S + 0.12, S + 0.1, 0.07), dark);
    housing.position.set(0, Y0, 0);
    this.root.add(housing);

    this.screens = {};
    this.frames = {};
    const labelsY = Y0 + S / 2 + 0.07;
    for (const [view, x] of [['AP', -S / 2 - 0.02], ['LAT', S / 2 + 0.02]]) {
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
      const lbl = makeLabel(view === 'AP' ? 'AP' : 'LATERAL');
      lbl.position.set(x, labelsY, 0.036);
      this.root.add(lbl);
    }

    // button strip under the screens
    const W = 2 * S + 0.12;
    this.panel = new Panel({
      width: W, height: 0.13, bg: '#101619f2',
      items: [
        { id: 'ap', type: 'button', x: 20, y: 18, w: 250, h: 94, label: 'AP  ☢', size: 40, onPress: () => app.shoot('AP'), active: () => app.state.busy === 'AP' },
        { id: 'lat', type: 'button', x: 290, y: 18, w: 300, h: 94, label: 'LATERAL  ☢', size: 40, onPress: () => app.shoot('LAT'), active: () => app.state.busy === 'LAT' },
        { id: 'inv', type: 'button', x: 610, y: 18, w: 170, h: 94, label: 'Invert', size: 34, onPress: () => app.toggleInvert(), active: () => app.state.invert },
        { id: 'rad', type: 'label', x: 800, y: 18, w: 190, h: 94, size: 30, color: '#ffd770', align: 'left', label: () => app.state.busy ? '● X-RAY' : '' },
      ],
    });
    this.panel.mesh.position.set(0, Y0 - S / 2 - 0.13, 0.03);
    this.panel.mesh.rotation.x = -0.25;
    this.root.add(this.panel.mesh);
  }

  imageUpdated(view) {
    this.screens[view].tex.needsUpdate = true;
    for (const v of ['AP', 'LAT']) this.frames[v].material.color.set(v === view ? 0xffc83a : 0x15191c);
  }

  /** Place across the table from the surgeon, facing them. */
  place(sideSign) {
    this.root.position.set(1.2 * sideSign, 0, 0.8);
    this.root.lookAt(-0.7 * sideSign, 0, 0.05);
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#9fc6d2'; g.font = '600 32px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.0375), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
}
