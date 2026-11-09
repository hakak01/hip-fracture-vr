// A flat 3D panel drawn on a canvas, with buttons, toggles and sliders.
// Works with VR controller rays, hand pinch rays and mouse/touch taps.
import * as THREE from 'three';

const PX_PER_M = 1000;

export class Panel {
  /**
   * @param {object} opt
   *  width, height: metres
   *  items: [{id, type:'button'|'slider'|'label', x,y,w,h (px), label, active(), onPress(), value(), onChange(v)}]
   *  title: optional heading text
   */
  constructor({ width, height, items, title = '', bg = '#16252dee' }) {
    this.width = width;
    this.height = height;
    this.items = items;
    this.title = title;
    this.bg = bg;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.userData.panel = this;
    this.hover = new Map(); // pointerId -> item
    this.capture = new Map(); // pointerId -> slider item being dragged
    this.pressedFlash = null;
    this.draw();
  }

  itemAt(uv) {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    return this.items.find(it => it.type !== 'label' && x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) || null;
  }

  sliderValue(it, uv) {
    const x = uv.x * this.canvas.width;
    return THREE.MathUtils.clamp((x - it.x - 14) / (it.w - 28), 0, 1);
  }

  pointerMove(id, uv) {
    const cap = this.capture.get(id);
    if (cap) { cap.onChange(this.sliderValue(cap, uv)); this.draw(); return; }
    const it = uv ? this.itemAt(uv) : null;
    if (this.hover.get(id) !== it) { this.hover.set(id, it); this.draw(); }
  }

  pointerDown(id, uv) {
    const it = this.itemAt(uv);
    if (!it) return false;
    if (it.type === 'slider') {
      this.capture.set(id, it);
      it.onChange(this.sliderValue(it, uv));
    } else if (it.onPress) {
      it.onPress();
      this.pressedFlash = it;
      setTimeout(() => { this.pressedFlash = null; this.draw(); }, 160);
    }
    this.draw();
    return true;
  }

  pointerUp(id) {
    if (this.capture.delete(id)) this.draw();
  }

  pointerLeave(id) {
    this.capture.delete(id);
    if (this.hover.get(id)) { this.hover.delete(id); this.draw(); }
  }

  draw() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    roundRect(c, 0, 0, W, H, 22);
    c.fillStyle = this.bg; c.fill();
    c.lineWidth = 4; c.strokeStyle = '#3a5560'; c.stroke();
    if (this.title) {
      c.fillStyle = '#9fc6d2'; c.font = '600 30px system-ui, sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(this.title, 22, 16);
    }
    const hovered = new Set(this.hover.values());
    for (const it of this.items) {
      if (it.type === 'label') {
        c.fillStyle = it.color || '#c8d8dc';
        c.font = `${it.weight || 500} ${it.size || 28}px system-ui, sans-serif`;
        c.textAlign = it.align || 'left'; c.textBaseline = 'middle';
        const text = typeof it.label === 'function' ? it.label() : it.label;
        c.fillText(text, it.align === 'center' ? it.x + it.w / 2 : it.x, it.y + it.h / 2);
        continue;
      }
      const isHover = hovered.has(it);
      if (it.type === 'slider') {
        const v = it.value();
        roundRect(c, it.x, it.y, it.w, it.h, it.h / 2);
        c.fillStyle = '#24343c'; c.fill();
        roundRect(c, it.x, it.y, 28 + (it.w - 28) * v, it.h, it.h / 2);
        c.fillStyle = '#0a6f8f'; c.fill();
        const kx = it.x + 14 + (it.w - 28) * v;
        c.beginPath(); c.arc(kx, it.y + it.h / 2, it.h * 0.62, 0, Math.PI * 2);
        c.fillStyle = isHover || this.capture.size ? '#ffffff' : '#d8e6ea'; c.fill();
        if (it.label) {
          c.fillStyle = '#c8d8dc'; c.font = '500 26px system-ui, sans-serif';
          c.textAlign = 'left'; c.textBaseline = 'bottom';
          c.fillText(typeof it.label === 'function' ? it.label() : it.label, it.x, it.y - 8);
        }
        continue;
      }
      const active = it.active ? it.active() : false;
      const flash = this.pressedFlash === it;
      roundRect(c, it.x, it.y, it.w, it.h, 16);
      c.fillStyle = flash ? '#2fa4c8' : active ? (it.activeColor || '#0a6f8f') : (it.color || '#24343c');
      c.fill();
      c.lineWidth = isHover ? 6 : 3;
      c.strokeStyle = isHover ? '#ffe08a' : active ? '#2fa4c8' : '#3a525c';
      c.stroke();
      c.fillStyle = '#ffffff';
      c.font = `${it.weight || 600} ${it.size || 32}px system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const text = typeof it.label === 'function' ? it.label() : it.label;
      c.fillText(text, it.x + it.w / 2, it.y + it.h / 2 + 1);
    }
    this.texture.needsUpdate = true;
  }
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
