// Digitally reconstructed radiographs (DRR) for the lateral viewer.
// Adapted from ../../js/drr.js (VR trainer). GPU ray-casting gives the X-ray line integral (Beer-Lambert);
// the CPU then applies C-arm style image processing (harmonisation, edge enhancement, automatic contrast,
// noise, round field). The CT is stored at three detail levels: fine (0.8 mm, proximal femur and acetabulum),
// mid (1.6 mm, every bone the beams can see) and coarse (3.2 mm, soft tissue). Each bone fragment has its own
// rigid transform, so moved fragments appear moved on the image.
import * as THREE from 'three';

const SIZE = 512;    // image resolution
const STRIPS = 8;    // the image is rendered in strips over several frames
const L_MAX = 24;    // range of the encoded line integral

const vertexShader = /* glsl */`
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uCoarse;   // r: soft tissue HU (coded)
  uniform sampler3D uMid;      // r: bone excess above soft tissue, g: fragment label
  uniform sampler3D uFine;
  uniform vec3 uCLo, uCSize, uMLo, uMSize, uFLo, uFSize;   // box corners and sizes (mm)
  uniform vec3 uSrc, uDetC, uDetU, uDetV;
  uniform mat4 uInvP, uInvD;   // patient frame -> rest frame of the proximal / distal fragment
  uniform float uMuW, uBoneGain, uBaseScale, uBaseOff, uExcScale;
  uniform float uStepFine, uStepMid, uStepCoarse;
  in vec2 vUv;
  layout(location = 0) out highp vec4 fragOut;

  vec3 safeInv(vec3 d) {
    vec3 sd = mix(vec3(-1.0), vec3(1.0), step(0.0, d)) * max(abs(d), vec3(1e-8));
    return 1.0 / sd;
  }
  // distance (mm) of p inside a box; negative outside
  float inside(vec3 p, vec3 lo, vec3 size) {
    vec3 a = p - lo, b = lo + size - p;
    return min(min(min(a.x, a.y), min(a.z, b.x)), min(b.y, b.z));
  }
  // bone excess (HU) split by owner: x static, y proximal (head-neck) fragment, z distal (shaft) fragment
  vec3 split(vec2 s) {
    float e = s.r * 255.0 * uExcScale;
    float v = s.g * 255.0;
    float pw = v <= 128.0 ? v / 128.0 : (255.0 - v) / 127.0;
    float dw = v <= 128.0 ? 0.0 : (v - 128.0) / 127.0;
    return e * vec3(max(0.0, 1.0 - pw - dw), pw, dw);
  }
  vec3 bone(vec3 p) {
    float dm = inside(p, uMLo, uMSize);
    if (dm < 0.0) return vec3(0.0);
    float df = inside(p, uFLo, uFSize);
    if (df >= 4.0) return split(texture(uFine, (p - uFLo) / uFSize).rg);
    vec3 m = split(texture(uMid, (p - uMLo) / uMSize).rg);
    if (df <= 0.0) return m;
    vec3 f = split(texture(uFine, (p - uFLo) / uFSize).rg);
    return mix(m, f, smoothstep(0.0, 4.0, df));
  }

  void main() {
    vec3 D = uDetC + (vUv.x * 2.0 - 1.0) * uDetU + (vUv.y * 2.0 - 1.0) * uDetV;
    vec3 dir = D - uSrc;
    float len = length(dir);
    dir /= len;
    vec3 inv = safeInv(dir);
    vec3 t0 = (uCLo - uSrc) * inv, t1 = (uCLo + uCSize - uSrc) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float ta = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float tb = min(min(min(tmax.x, tmax.y), tmax.z), len);
    float L = 0.0;
    if (tb > ta) {
      float t = ta + uStepFine * fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      for (int i = 0; i < 3000; i++) {
        if (t >= tb) break;
        vec3 p = uSrc + dir * t;
        float st = inside(p, uFLo, uFSize) > -2.0 ? uStepFine : (inside(p, uMLo, uMSize) > -2.0 ? uStepMid : uStepCoarse);
        float hu = texture(uCoarse, (p - uCLo) / uCSize).r * 255.0 * uBaseScale + uBaseOff;
        float mu = uMuW * max(0.0, 1.0 + (hu > 0.0 ? uBoneGain : 1.0) * hu / 1000.0);
        float e = bone(p).x;
        e += bone((uInvP * vec4(p, 1.0)).xyz).y;
        e += bone((uInvD * vec4(p, 1.0)).xyz).z;
        mu += uMuW * uBoneGain * e / 1000.0;
        L += mu * st;
        t += st;
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

function tex3d(data, dims, format) {
  const t = new THREE.Data3DTexture(data, dims[0], dims[1], dims[2]);
  t.format = format;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

function boxOf(v) {
  const sp = v.spacing;
  const lo = new THREE.Vector3().fromArray(v.center0).subScalar(sp / 2);
  const size = new THREE.Vector3(v.dims[0] * sp, v.dims[1] * sp, v.dims[2] * sp);
  return { lo, size };
}

export class DRR {
  constructor(renderer, volumes, meta) {
    this.renderer = renderer;
    const V = meta.volume;
    const rg = v => {
      const n = v.a.length, out = new Uint8Array(2 * n);
      for (let i = 0; i < n; i++) { out[2 * i] = v.a[i]; out[2 * i + 1] = v.b[i]; }
      return out;
    };
    const C = boxOf(volumes.coarse), M = boxOf(volumes.mid), F = boxOf(volumes.fine);
    this.uniforms = {
      uCoarse: { value: tex3d(volumes.coarse.a, volumes.coarse.dims, THREE.RedFormat) },
      uMid: { value: tex3d(rg(volumes.mid), volumes.mid.dims, THREE.RGFormat) },
      uFine: { value: tex3d(rg(volumes.fine), volumes.fine.dims, THREE.RGFormat) },
      uCLo: { value: C.lo }, uCSize: { value: C.size },
      uMLo: { value: M.lo }, uMSize: { value: M.size },
      uFLo: { value: F.lo }, uFSize: { value: F.size },
      uSrc: { value: new THREE.Vector3() }, uDetC: { value: new THREE.Vector3() },
      uDetU: { value: new THREE.Vector3() }, uDetV: { value: new THREE.Vector3() },
      uInvP: { value: new THREE.Matrix4() }, uInvD: { value: new THREE.Matrix4() },
      uMuW: { value: 0.02 }, uBoneGain: { value: 3.5 },
      uBaseScale: { value: V.baseScale }, uBaseOff: { value: V.baseOffset }, uExcScale: { value: V.excessScale },
      uStepFine: { value: 0.5 }, uStepMid: { value: 1.0 }, uStepCoarse: { value: 2.5 },
    };
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
    this.L = new Float32Array(SIZE * SIZE);
    this.A = new Float32Array(SIZE * SIZE);
    this.B = new Float32Array(SIZE * SIZE);
    this.T = new Float32Array(SIZE * SIZE);
    this.noise = new Float32Array(SIZE * SIZE * 2);
    for (let i = 0; i < this.noise.length; i++) {
      this.noise[i] = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    const g = this.canvas.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, SIZE, SIZE);
    this.job = null;
    this.info = {};
    // C-arm look (tuned by eye against intra-operative images)
    this.params = { harm: 0.4, harmR: 40, sharp: 1.6, sharpR: 3, lo: 0.004, hi: 0.996, gamma: 1.15, noise: 0.018, central: 0.7 };
    this.invert = false;
    this.onImage = null;
  }

  /** Start a shot. geom: { src, det, U, V } (patient frame, mm; U,V = detector half-axes); invP/invD: Matrix4. */
  shoot(geom, invP, invD, info = {}) {
    const u = this.uniforms;
    u.uSrc.value.copy(geom.src);
    u.uDetC.value.copy(geom.det);
    u.uDetU.value.copy(geom.U);
    u.uDetV.value.copy(geom.V);
    u.uInvP.value.copy(invP);
    u.uInvD.value.copy(invD);
    this.job = { info, strip: 0, strips: STRIPS };
  }

  get busy() { return !!this.job; }

  /** Call once per frame. Renders one strip; the last strip is followed by the image processing. */
  tick() {
    const job = this.job;
    if (!job) return false;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const h = SIZE / job.strips;
    this.rt.scissorTest = true;
    this.rt.scissor.set(0, job.strip * h, SIZE, h);
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    job.strip++;
    if (job.strip < job.strips) return false;
    r.readRenderTargetPixels(this.rt, 0, 0, SIZE, SIZE, this.pixels);
    this.job = null;
    const W = SIZE, px = this.pixels, scale = L_MAX / 65535, L = this.L;
    for (let y = 0; y < W; y++) {
      const src = (W - 1 - y) * W; // read-back row 0 is the bottom of the image
      for (let x = 0; x < W; x++) {
        const i = (src + x) * 4;
        L[y * W + x] = (px[i] * 256 + px[i + 1]) * scale;
      }
    }
    this.info = job.info;
    this.process();
    if (this.onImage) this.onImage();
    return true;
  }

  process() {
    const W = SIZE, N = W * W, L = this.L, A = this.A, B = this.B, T = this.T, P = this.params;
    // harmonisation: remove the slow soft-tissue thickness gradient (as C-arm processing does)
    boxBlur(L, A, T, W, W, P.harmR);
    boxBlur(A, B, T, W, W, P.harmR);
    for (let i = 0; i < N; i++) A[i] = L[i] - P.harm * B[i];
    // edge enhancement
    boxBlur(A, B, T, W, W, P.sharpR);
    for (let i = 0; i < N; i++) A[i] = A[i] + P.sharp * (A[i] - B[i]);
    // automatic brightness / contrast measured in the central part of the field (like the dose control)
    const R = W / 2, Rc2 = (R * P.central) ** 2;
    const samples = [];
    for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x += 2) {
      const dx = x - R + 0.5, dy = y - R + 0.5;
      if (dx * dx + dy * dy < Rc2) samples.push(A[y * W + x]);
    }
    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor(samples.length * P.lo)];
    const hi = samples[Math.floor(samples.length * P.hi)];
    const span = Math.max(1e-3, hi - lo);
    const ctx = this.canvas.getContext('2d');
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
        g = Math.pow(this.invert ? b : 1 - b, P.gamma); // default: dense = dark, like the C-arm screen
        g += P.noise * this.noise[noff + i];
        g *= 1 - 0.16 * rr * rr;              // intensifier vignetting
        g *= Math.min(1, (1 - rr) * R / 2.5); // soft field edge
        g = g < 0 ? 0 : g > 1 ? 1 : g;
      }
      const v = Math.round(g * 255);
      const o = i * 4;
      d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.drawOverlay(ctx);
  }

  drawOverlay(ctx) {
    const W = SIZE, info = this.info || {};
    ctx.fillStyle = '#ffd770';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(info.label || '', 14, 12);
    ctx.font = '500 15px system-ui, sans-serif';
    if (info.sub) ctx.fillText(info.sub, 14, 44);
    ctx.textAlign = 'right';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(info.side || 'R', W - 16, 10);
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('68 kV  1.9 mA', 14, W - 12);
  }
}
