// Loads meta.json, the bone meshes (bones.glb, meshopt) and the three volume levels for the X-ray simulation.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

async function fetchBuffer(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

async function gunzip(buf) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { gunzipSync } = await import('three/addons/libs/fflate.module.js');
  return gunzipSync(new Uint8Array(buf));
}

function undelta(a, nx) {
  // reverse the byte-delta filter applied along x in tools/build_assets.py
  for (let r = 0; r < a.length; r += nx) {
    let acc = 0;
    for (let i = r; i < r + nx; i++) { acc = (acc + a[i]) & 255; a[i] = acc; }
  }
}

export async function loadAssets(base, onProgress = () => {}) {
  const meta = await (await fetch(base + 'meta.json')).json();
  const L = meta.volume.levels;
  const names = ['fine', 'mid', 'coarse'];
  const prog = { glb: 0, fine: 0, mid: 0, coarse: 0 };
  const report = () => onProgress(0.15 * prog.glb + 0.45 * prog.fine + 0.25 * prog.mid + 0.15 * prog.coarse);
  const [glbBuf, ...volBufs] = await Promise.all([
    fetchBuffer(base + meta.meshes.file, p => { prog.glb = p; report(); }),
    ...names.map(n => fetchBuffer(base + L[n].file, p => { prog[n] = p; report(); })),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(glbBuf, base);
  const volumes = {};
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    const raw = await gunzip(volBufs[i]);
    const [nx, ny, nz] = L[n].dims;
    const count = nx * ny * nz;
    const planes = n === 'coarse' ? 1 : 2;
    if (raw.length !== planes * count) throw new Error(`Volume ${n} size mismatch`);
    const first = raw.subarray(0, count);
    undelta(first, nx);
    volumes[n] = { dims: L[n].dims, spacing: L[n].spacing, center0: L[n].center0, a: first, b: planes > 1 ? raw.subarray(count, 2 * count) : null };
  }
  return { meta, gltf, volumes };
}
