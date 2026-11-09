// Loads the CT-derived assets: meta.json, anatomy.glb (meshopt) and the DRR volume.
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
  const parts = { glb: 0, vol: 0 };
  const report = () => onProgress(0.3 * parts.glb + 0.7 * parts.vol);
  const [glbBuf, volGz] = await Promise.all([
    fetchBuffer(base + meta.meshes.file, p => { parts.glb = p; report(); }),
    fetchBuffer(base + meta.volume.file, p => { parts.vol = p; report(); }),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(glbBuf, base);

  const raw = await gunzip(volGz);
  const [nx, ny, nz] = meta.volume.dims;
  const n = nx * ny * nz;
  if (raw.length !== 3 * n) throw new Error('Volume size mismatch');
  const baseCh = raw.subarray(0, n);
  const excess = raw.subarray(n, 2 * n);
  const label = raw.subarray(2 * n, 3 * n);
  undelta(baseCh, nx);
  undelta(excess, nx);
  return { meta, gltf, volume: { base: baseCh, excess, label } };
}
