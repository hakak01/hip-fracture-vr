// Digitally reconstructed radiographs (DRR) from the CT volume.
// GPU ray-casting gives the X-ray line integral; the CPU then applies C-arm style image processing.
// Each bone fragment has its own rigid transform, so moved fragments appear moved on the image.
import * as THREE from 'three';

const SIZE = 512;        // image resolution
const STRIPS = 8;        // image is rendered in strips over several frames
const L_MAX = 24;        // range of the encoded line integral
const MAX_FRAGS = 4;

const vertexShader = /* glsl */`
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uVol;   // r: static attenuation (HU-coded), g: moving-bone excess
  uniform sampler3D uMemb;  // r: proximal fragment membership, g: distal (linear filtered = smooth edges)
  uniform vec3 uCorner;
  uniform vec3 uSize;
  uniform vec3 uSrc;
  uniform vec3 uDetC;
  uniform vec3 uDetU;
  uniform vec3 uDetV;
  uniform float uStep;
  uniform float uMuW;
  uniform float uBoneGain;
  uniform int uNFrag;
  uniform mat4 uFragInv[${MAX_FRAGS}];
  uniform float uFragLab[${MAX_FRAGS}];
  in vec2 vUv;
  layout(location = 0) out highp vec4 fragOut;

  float muOf(float v) {
    float hu = v * 3060.0 - 1000.0;
    float g = hu > 0.0 ? uBoneGain : 1.0;
    return uMuW * max(0.0, 1.0 + g * hu / 1000.0);
  }

  void main() {
    vec3 D = uDetC + (vUv.x * 2.0 - 1.0) * uDetU + (vUv.y * 2.0 - 1.0) * uDetV;
    vec3 dir = D - uSrc;
    float len = length(dir);
    dir /= len;
    vec3 sdir = sign(dir) * max(abs(dir), vec3(1e-6));
    vec3 inv = 1.0 / sdir;
    vec3 t0 = (uCorner - uSrc) * inv;
    vec3 t1 = (uCorner + uSize - uSrc) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float ta = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float tb = min(min(min(tmax.x, tmax.y), tmax.z), len);
    float L = 0.0;
    if (tb > ta) {
      float t = ta + uStep * fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      for (int i = 0; i < 1400; i++) {
        if (t >= tb) break;
        vec3 p = uSrc + dir * t;
        vec2 s = texture(uVol, (p - uCorner) / uSize).rg;
        float mu = muOf(s.r);
        for (int k = 0; k < ${MAX_FRAGS}; k++) {
          if (k >= uNFrag) break;
          vec3 q = (uFragInv[k] * vec4(p, 1.0)).xyz;
          vec3 tq = (q - uCorner) / uSize;
          if (all(greaterThanEqual(tq, vec3(0.0))) && all(lessThanEqual(tq, vec3(1.0)))) {
            vec2 mm = texture(uMemb, tq).rg;
            float w = k == 0 ? mm.r : mm.g;
            if (w > 0.0) mu += w * uMuW * uBoneGain * texture(uVol, tq).g * 3.06;
          }
        }
        L += mu * uStep;
        t += uStep;
      }
    }
    float q = floor(clamp(L / ${L_MAX.toFixed(1)}, 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(q / 256.0);
    fragOut = vec4(hi / 255.0, (q - hi * 256.0) / 255.0, 0.0, 1.0);
  }
`;

function boxBlur(src, dst, tmp, w, h, r) {
  // separable box blur with clamped edges
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

export class DRR {
  constructor(renderer, volume, meta) {
    this.renderer = renderer;
    const vm = meta.volume;
    const [nx, ny, nz] = vm.dims;
    const n = nx * ny * nz;
    const rg = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) { rg[2 * i] = volume.base[i]; rg[2 * i + 1] = volume.excess[i]; }
    const vol = new THREE.Data3DTexture(rg, nx, ny, nz);
    vol.format = THREE.RGFormat;
    vol.type = THREE.UnsignedByteType;
    vol.minFilter = vol.magFilter = THREE.LinearFilter;
    vol.unpackAlignment = 1;
    vol.needsUpdate = true;
    // fragment membership (0/255) per voxel, linearly filtered so moved fragments have smooth edges
    const memb = new Uint8Array(n * 2);
    const lp = vm.labels.proximal, ld = vm.labels.distal, labels = volume.label;
    for (let i = 0; i < n; i++) {
      if (labels[i] === lp) memb[2 * i] = 255;
      else if (labels[i] === ld) memb[2 * i + 1] = 255;
    }
    const lab = new THREE.Data3DTexture(memb, nx, ny, nz);
    lab.format = THREE.RGFormat;
    lab.type = THREE.UnsignedByteType;
    lab.minFilter = lab.magFilter = THREE.LinearFilter;
    lab.unpackAlignment = 1;
    lab.needsUpdate = true;

    const sp = vm.spacing;
    this.uniforms = {
      uVol: { value: vol },
      uMemb: { value: lab },
      uCorner: { value: new THREE.Vector3().fromArray(vm.corner) },
      uSize: { value: new THREE.Vector3(nx * sp, ny * sp, nz * sp) },
      uSrc: { value: new THREE.Vector3() },
      uDetC: { value: new THREE.Vector3() },
      uDetU: { value: new THREE.Vector3() },
      uDetV: { value: new THREE.Vector3() },
      uStep: { value: 1.0 },
      uMuW: { value: 0.02 },
      uBoneGain: { value: 3.0 },
      uNFrag: { value: 1 },
      uFragInv: { value: Array.from({ length: MAX_FRAGS }, () => new THREE.Matrix4()) },
      uFragLab: { value: [vm.labels.proximal, vm.labels.distal, 0, 0] },
    };
    // Fragments: label id + rigid transform in the patient frame (mm), set from the physics.
    this.fragments = [
      { label: vm.labels.proximal, matrix: new THREE.Matrix4() },
      { label: vm.labels.distal, matrix: new THREE.Matrix4() },
    ];

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.uniforms, vertexShader, fragmentShader,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.pixels = new Uint8Array(SIZE * SIZE * 4);
    this.A = new Float32Array(SIZE * SIZE);
    this.B = new Float32Array(SIZE * SIZE);
    this.T = new Float32Array(SIZE * SIZE);
    this.noise = new Float32Array(SIZE * SIZE * 2);
    for (let i = 0; i < this.noise.length; i++) {
      this.noise[i] = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    }
    this.canvases = {};
    for (const v of ['AP', 'LAT', 'OBL']) {
      const c = document.createElement('canvas');
      c.width = c.height = SIZE;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, SIZE, SIZE);
      this.canvases[v] = c;
    }
    this.job = null;
    this.Lv = {};   // stored line-integral images per view
    this.time = {};
    this.params = { harm: 0.35, harmR: 30, sharp: 1.5, sharpR: 4, lo: 0.01, hi: 0.997, gamma: 0.8, noise: 0.02 };
    this.invert = false;
    this.sideLetter = 'R';
    this.onImage = null; // callback(view)
  }

  /** Start a shot. geom is in the patient frame (mm). */
  shoot(view, geom) {
    const u = this.uniforms;
    u.uSrc.value.copy(geom.src);
    u.uDetC.value.copy(geom.det);
    u.uDetU.value.copy(geom.U);
    u.uDetV.value.copy(geom.V);
    u.uNFrag.value = this.fragments.length;
    this.fragments.forEach((f, i) => {
      u.uFragInv.value[i].copy(f.matrix).invert();
      u.uFragLab.value[i] = f.label;
    });
    // more, smaller strips in VR keep the headset frame rate smooth
    this.job = { view, strip: 0, strips: this.renderer.xr.isPresenting ? 16 : STRIPS };
  }

  get busy() { return !!this.job; }

  /** Call once per frame. Renders a strip; finishes with image processing. */
  tick() {
    const job = this.job;
    if (!job) return;
    const r = this.renderer;
    const xrOn = r.xr.enabled;
    const prev = r.getRenderTarget();
    r.xr.enabled = false;
    const h = SIZE / job.strips;
    this.rt.scissorTest = true;
    this.rt.scissor.set(0, job.strip * h, SIZE, h);
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.xr.enabled = xrOn;
    job.strip++;
    if (job.strip < job.strips) return;
    r.readRenderTargetPixels(this.rt, 0, 0, SIZE, SIZE, this.pixels);
    this.job = null;
    const W = SIZE, px = this.pixels, scale = L_MAX / 65535;
    const L = this.Lv[job.view] || (this.Lv[job.view] = new Float32Array(W * W));
    for (let y = 0; y < W; y++) {
      // flip rows: read-back row 0 is the bottom of the image
      const src = (W - 1 - y) * W;
      for (let x = 0; x < W; x++) {
        const i = (src + x) * 4;
        L[y * W + x] = (px[i] * 256 + px[i + 1]) * scale;
      }
    }
    this.time[job.view] = new Date();
    this.process(job.view);
    if (this.onImage) this.onImage(job.view);
  }

  /** Re-run the image processing on stored shots (e.g. after Invert). */
  reprocess() {
    for (const v of Object.keys(this.Lv)) this.process(v);
  }

  process(view) {
    const W = SIZE, N = W * W, L = this.Lv[view], A = this.A, B = this.B, T = this.T, P = this.params;
    if (!L) return;
    // "harmonisation": remove the slow soft-tissue thickness gradient (as C-arm processing does)
    boxBlur(L, A, T, W, W, P.harmR);
    boxBlur(A, B, T, W, W, P.harmR);
    for (let i = 0; i < N; i++) A[i] = L[i] - P.harm * B[i];
    // edge enhancement
    boxBlur(A, B, T, W, W, P.sharpR);
    for (let i = 0; i < N; i++) A[i] = A[i] + P.sharp * (A[i] - B[i]);
    // automatic brightness / contrast from the values inside the round field
    const R = W / 2, R2 = (R - 4) * (R - 4);
    const samples = [];
    for (let y = 0; y < W; y += 3) for (let x = 0; x < W; x += 3) {
      const dx = x - R + 0.5, dy = y - R + 0.5;
      if (dx * dx + dy * dy < R2) samples.push(A[y * W + x]);
    }
    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor(samples.length * P.lo)];
    const hi = samples[Math.floor(samples.length * P.hi)];
    const span = Math.max(1e-3, hi - lo);
    const ctx = this.canvases[view].getContext('2d');
    const img = ctx.createImageData(W, W);
    const d = img.data;
    const noff = Math.floor(Math.random() * N);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = x - R + 0.5, dy = y - R + 0.5;
      const rr = Math.sqrt(dx * dx + dy * dy) / R;
      let g = 0;
      if (rr < 1) {
        let b = (A[i] - lo) / span;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        g = this.invert ? b : 1 - b;      // default: dense = dark, like the C-arm screen
        g = Math.pow(g, P.gamma);
        g += P.noise * this.noise[noff + i];
        g *= 1 - 0.16 * rr * rr;          // intensifier vignetting
        g *= Math.min(1, (1 - rr) * R / 2.5); // soft field edge
        g = g < 0 ? 0 : g > 1 ? 1 : g;
      }
      const v = Math.round(g * 255);
      const o = i * 4;
      d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.drawOverlay(ctx, view);
  }

  drawOverlay(ctx, view) {
    const W = SIZE;
    ctx.fillStyle = '#ffd770';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText({ AP: 'AP', LAT: 'LAT', OBL: 'OBL 30°' }[view], 14, 12);
    ctx.textAlign = 'right';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(this.sideLetter, W - 16, 10);
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('68 kV  1.9 mA', 14, W - 12);
    ctx.textAlign = 'right';
    const t = this.time[view] || new Date();
    ctx.fillText(t.toTimeString().slice(0, 8), W - 14, W - 12);
  }
}
