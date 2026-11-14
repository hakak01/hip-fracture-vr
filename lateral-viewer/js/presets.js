// Malreduction presets. The head-neck (proximal) fragment can only turn about the femoral head centre
// (the head stays in the acetabulum); the shaft (distal) fragment can move freely.
// Each preset maps a severity t (0 = mild, 1 = severe) to the two fragment transforms (patient frame, mm).
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const V = a => new THREE.Vector3().fromArray(a);

/** Anatomical frame at the fracture, from meta.json landmarks (traction-table position).
 *  verts(name) gives the mesh vertices, used to find the anteromedial cortex on each side of the fracture. */
export function fractureFrame(meta, verts) {
  const L = meta.landmarks;
  const s = V(L.shaftAxis).normalize();                       // along the shaft, towards the knee
  const a = V(L.anterior).normalize();                        // anterior, perpendicular to the shaft
  const med = new THREE.Vector3(1, 0, 0);                     // right hip: medial = +x
  med.addScaledVector(s, -med.dot(s)).addScaledVector(a, -med.dot(a)).normalize();
  const t = new THREE.Vector3().crossVectors(s, a).normalize(); // transverse axis (flexion / angulation)
  const fx = V(meta.fracture.point), n = V(meta.fracture.normal).normalize();
  // anteromedial cortex: surface points within 5 mm of the fracture, medial half of the fracture
  const band = name => verts(name).filter(p => { const d = p.clone().sub(fx); return Math.abs(d.dot(n)) <= 5 && d.dot(med) >= 0; });
  const bandP = band('femur_prox'), bandD = band('femur_dist');
  const anterior = pts => pts.reduce((b, p) => (!b || p.dot(a) > b.dot(a) ? p : b), null);
  return {
    s, a, med, t,
    hc: V(L.headCenter), neck: V(L.neckAxis).normalize(), knee: V(L.knee),
    canal: V(L.canal), antProx: anterior(bandP) || V(L.antProx), antDist: anterior(bandD) || V(L.antDist),
    bandP, bandD, fx, version: meta.measured.anteversion,
  };
}

const trans = (dir, mm) => new THREE.Matrix4().makeTranslation(dir.x * mm, dir.y * mm, dir.z * mm);

/** Rotation about an axis through a pivot, by deg, in the sense that moves `point` towards `want`. */
function rotToward(axis, pivot, point, want, deg) {
  const make = ang => new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, ang))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  const r = deg * Math.PI / 180;
  const m = make(r);
  const moved = point.clone().applyMatrix4(m).sub(point);
  return moved.dot(want) >= 0 ? m : make(-r);
}

// building blocks (f = fracture frame)
const M = {
  shaftBack: (f, mm) => trans(f.a, -mm),
  shaftForward: (f, mm) => trans(f.a, mm),
  neckFlex: (f, deg) => rotToward(f.t, f.hc, f.fx, f.a, deg),                    // fracture end of the neck fragment goes forward
  neckExtend: (f, deg) => rotToward(f.t, f.hc, f.fx, f.a.clone().negate(), deg),
  apexPost: (f, deg) => rotToward(f.t, f.antDist, f.knee, f.a, deg),            // hinge on the anterior cortex, knee end forward
  shaftIR: (f, deg) => rotToward(f.s, f.canal, f.canal.clone().add(f.a), f.med, deg),           // front of the shaft turns medially
  shaftER: (f, deg) => rotToward(f.s, f.canal, f.canal.clone().add(f.a), f.med.clone().negate(), deg),
  neckRetro: (f, deg) => rotToward(f.s, f.hc, f.hc.clone().addScaledVector(f.neck, 60), f.a, deg), // trochanter end forward = head points back
};

const I = () => new THREE.Matrix4();

export const PRESETS = [
  {
    id: 'anat', name: '1. Anatomical reduction', range: null,
    build: () => ({ P: I(), D: I() }),
    what: 'Reference. Both fragments are back in their normal place.',
    spot: 'Lateral: the anterior cortex of the neck runs into the anterior cortex of the shaft as one smooth line. Head, neck and shaft are in line.',
  },
  {
    id: 'A', name: '2. Subtype A: neck cortex in front', range: 'shaft 1 → 5 mm back',
    build: (f, t) => ({ P: I(), D: M.shaftBack(f, lerp(1, 5, t)) }),
    what: 'The neck fragment\'s anterior cortex sits just in front of the shaft\'s anterior cortex. It rests on the shaft, so it is supported.',
    spot: 'Lateral: a small step at the front of the fracture; the neck cortex is outside (in front of) the shaft cortex.',
  },
  {
    id: 'P', name: '3. Subtype P: neck cortex behind', range: 'shaft 1 → 6 mm forward',
    build: (f, t) => ({ P: I(), D: M.shaftForward(f, lerp(1, 6, t)) }),
    what: 'The neck fragment\'s anterior cortex has slipped behind the shaft\'s anterior cortex, into the canal. No cortical support: it can collapse.',
    spot: 'Lateral: a step at the front of the fracture with the shaft cortex in front and the neck cortex behind it.',
  },
  {
    id: 'sag', name: '4. Posterior sag of the shaft', range: 'shaft 4 → 12 mm back',
    build: (f, t) => ({ P: I(), D: M.shaftBack(f, lerp(4, 12, t)) }),
    what: 'The shaft has dropped backwards (gravity, no support under the thigh).',
    spot: 'Lateral: the whole shaft lies behind the neck; big step at the anterior cortex and the posterior cortex line is broken.',
  },
  {
    id: 'flex', name: '5. Flexed neck fragment (anterior beak)', range: 'neck fragment 5° → 25° flexion',
    build: (f, t) => ({ P: M.neckFlex(f, lerp(5, 25, t)), D: I() }),
    what: 'The head-neck fragment has tipped forward about the head. Its anterior lip sticks out in front of the shaft.',
    spot: 'Lateral: an anterior "beak" at the fracture; the neck axis points up compared with the shaft; a gap opens at the back.',
  },
  {
    id: 'apex', name: '6. Apex-posterior angulation', range: '5° → 20°',
    build: (f, t) => ({ P: I(), D: M.apexPost(f, lerp(5, 20, t)) }),
    what: 'The fracture is bent with the point of the angle backwards (hinge on the anterior cortex).',
    spot: 'Lateral: neck and shaft axes meet at an angle; the fracture gapes at the back while the front is closed.',
  },
  {
    id: 'IR', name: '7a. Shaft over-rotated internally', range: '5° → 25°',
    build: (f, t) => ({ P: I(), D: M.shaftIR(f, lerp(5, 25, t)) }),
    what: 'The shaft is turned inwards (internal rotation) against the neck fragment. The fracture opens at the back and overlaps at the front.',
    spot: 'Lateral: the cortex outlines of neck and shaft no longer meet (a step), and a lucent gap opens at the back of the fracture. On AP the lesser trochanter looks smaller.',
  },
  {
    id: 'ER', name: '7b. Shaft over-rotated externally', range: '5° → 25°',
    build: (f, t) => ({ P: I(), D: M.shaftER(f, lerp(5, 25, t)) }),
    what: 'The shaft is turned outwards (external rotation) against the neck fragment. The fracture opens at the front and overlaps at the back.',
    spot: 'Lateral: the shaft cortex sits in front of the neck cortex (a step) and the fracture line gapes. On AP the lesser trochanter looks bigger.',
  },
  {
    id: 'retro', name: '8. Retroverted head-neck fragment', range: 'neck version 7° → −15° (normal 15°)',
    build: (f, t) => ({ P: M.neckRetro(f, lerp(8, 30, t)), D: I() }),
    what: 'The head-neck fragment has turned backwards (lost its anteversion).',
    spot: 'Lateral: the neck points backwards and the trochanteric end of the neck fragment swings forward, so its anterior corner stands proud of the shaft.',
  },
  {
    id: 'sagP', name: '9a. Sag + subtype P', range: 'shaft 4 → 7 mm back, neck fragment tips back 12° → 25°',
    build: (f, t) => ({ P: M.neckExtend(f, lerp(12, 25, t)), D: M.shaftBack(f, lerp(4, 7, t)) }),
    what: 'Shaft dropped back and the neck fragment fell back even further, so its cortex is behind the shaft cortex.',
    spot: 'Lateral: everything sags backwards and the neck cortex lies behind the shaft cortex (P).',
  },
  {
    id: 'flexSag', name: '9b. Flexed neck + sag', range: 'flexion 5° → 20°, sag 3 → 10 mm',
    build: (f, t) => ({ P: M.neckFlex(f, lerp(5, 20, t)), D: M.shaftBack(f, lerp(3, 10, t)) }),
    what: 'The common pair: the neck fragment tips forward while the shaft drops back.',
    spot: 'Lateral: a large anterior beak and a big step at the front of the fracture.',
  },
  {
    id: 'erSag', name: '9c. External rotation + sag', range: 'rotation 5° → 20°, sag 3 → 10 mm',
    build: (f, t) => ({ P: I(), D: M.shaftER(f, lerp(5, 20, t)).premultiply(M.shaftBack(f, lerp(3, 10, t))) }),
    what: 'The shaft is turned outwards and has dropped back.',
    spot: 'Lateral: step at the anterior cortex plus mismatched fracture edges.',
  },
];

/** Numbers measured from the anatomical position for a pair of transforms. */
export function measure(f, P, D) {
  // step between the anterior outlines (as seen on the lateral) of the two fragments at the anteromedial cortex
  const front = (pts, M) => { let m = -Infinity; const v = new THREE.Vector3(); for (const p of pts) m = Math.max(m, v.copy(p).applyMatrix4(M).dot(f.a)); return m; };
  const I4 = new THREE.Matrix4();
  const step = (front(f.bandP, P) - front(f.bandD, D)) - (front(f.bandP, I4) - front(f.bandD, I4));
  const c = f.canal.clone().applyMatrix4(D).sub(f.canal);
  const rot = new THREE.Matrix3().setFromMatrix4(D);
  const s2 = f.s.clone().applyMatrix3(rot);
  const angDist = Math.atan2(s2.dot(f.a), s2.dot(f.s)) * 180 / Math.PI;      // + = knee end forward
  const a2 = f.a.clone().applyMatrix3(rot);
  const a2p = a2.clone().addScaledVector(f.s, -a2.dot(f.s));
  const shaftRot = Math.atan2(a2p.dot(f.med), a2p.dot(f.a)) * 180 / Math.PI; // + = internal
  // neck fragment: flexion = turn about the transverse axis, version = turn about the shaft axis
  const rp = new THREE.Matrix3().setFromMatrix4(P);
  const sP = f.s.clone().applyMatrix3(rp);
  const neckFlex = Math.atan2(sP.dot(f.a), sP.dot(f.s)) * 180 / Math.PI;      // + = fracture end forward
  const lat = f.med.clone().negate(), lP = lat.clone().applyMatrix3(rp);
  const versionChange = -Math.atan2(lP.dot(f.a), lP.dot(lat)) * 180 / Math.PI; // + = more anteversion
  return { step, shiftAP: c.dot(f.a), shiftML: c.dot(f.med), angDist, shaftRot, neckFlex, versionChange };
}

const fmt = (v, d = 0) => (Math.abs(v) < 0.05 ? 0 : v).toFixed(d);

/** Short lines of plain text for the measurements panel. */
export function describe(m, f) {
  const out = [];
  const st = m.step;
  const type = Math.abs(st) < 1 ? 'N (smooth)' : st > 0 ? 'A (neck cortex in front)' : 'P (neck cortex behind)';
  out.push(`Anterior cortex step: ${fmt(Math.abs(st), 1)} mm, type ${type}`);
  if (Math.abs(m.shiftAP) > 0.3) out.push(`Shaft moved ${fmt(Math.abs(m.shiftAP), 1)} mm ${m.shiftAP > 0 ? 'forward' : 'back'}`);
  if (Math.abs(m.angDist) > 0.3) out.push(`Shaft angled ${fmt(Math.abs(m.angDist))}° (apex ${m.angDist > 0 ? 'posterior' : 'anterior'})`);
  if (Math.abs(m.shaftRot) > 0.3) out.push(`Shaft rotated ${fmt(Math.abs(m.shaftRot))}° ${m.shaftRot > 0 ? 'internally' : 'externally'}`);
  if (Math.abs(m.neckFlex) > 0.3) out.push(`Neck fragment ${m.neckFlex > 0 ? 'flexed' : 'extended'} ${fmt(Math.abs(m.neckFlex))}°`);
  if (Math.abs(m.versionChange) > 0.3) out.push(`Neck version ${fmt(f.version + m.versionChange)}° (normal ${fmt(f.version)}°)`);
  return out;
}
