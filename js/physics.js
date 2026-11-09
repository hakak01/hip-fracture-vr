// Fracture physics: two rigid fragments moved by muscle springs, gravity and the surgeon's hands.
// Units: millimetres, newtons, kilograms, seconds. All positions are in the (unmirrored) patient frame.
//
// Model
// - Proximal fragment P (head-neck): rotates about the femoral head centre (the hip joint holds the head).
// - Distal fragment D (shaft, lesser trochanter, whole leg): free rigid body.
// - Motion is "overdamped" (velocity proportional to force), which is how soft tissue behaves and keeps
//   the simulation stable. The final position is where all forces balance.
// - Fragments cannot pass through each other: contact points of one fragment are pushed out of the other
//   fragment's signed-distance field, with bone-on-bone friction.
import { Vector3, Quaternion, Matrix3, Matrix4 } from 'three';
import { MUSCLES, defaultSettings } from './muscles.js';

const G = 9.81;

class SDF {
  constructor(data, dims, origin, step, unit) {
    this.d = data; this.n = dims; this.o = origin; this.s = step; this.u = unit;
    this.nxy = dims[0] * dims[1];
  }

  /** Signed distance (mm, negative inside) at rest-frame point q; gradient written to g. */
  sample(q, g) {
    const s = this.s, n = this.n;
    const fx = (q.x - this.o[0]) / s, fy = (q.y - this.o[1]) / s, fz = (q.z - this.o[2]) / s;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= n[0] - 1 || fy >= n[1] - 1 || fz >= n[2] - 1) return 99;
    const i = fx | 0, j = fy | 0, k = fz | 0;
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const d = this.d, b = i + n[0] * (j + n[1] * k), nx = n[0], nxy = this.nxy;
    const c000 = d[b], c100 = d[b + 1], c010 = d[b + nx], c110 = d[b + nx + 1];
    const c001 = d[b + nxy], c101 = d[b + nxy + 1], c011 = d[b + nxy + nx], c111 = d[b + nxy + nx + 1];
    const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    if (g) {
      const dx0 = (c100 - c000) + ((c110 - c010) - (c100 - c000)) * ty;
      const dx1 = (c101 - c001) + ((c111 - c011) - (c101 - c001)) * ty;
      const dy0 = c10 - c00, dy1 = c11 - c01;
      g.set(dx0 + (dx1 - dx0) * tz, dy0 + (dy1 - dy0) * tz, c1 - c0);
    }
    return (c0 + (c1 - c0) * tz) * this.u;
  }
}

const tmpV = () => new Vector3();

class Body {
  /** rest -> current: x = R (p - origin) + pos */
  constructor(origin, linMob, rotMobBody) {
    this.origin = origin.clone();
    this.pos = origin.clone();
    this.q = new Quaternion();
    this.R = new Matrix3();
    this.Rt = new Matrix3();
    this.linMob = linMob;            // mm/s per N (0 = fixed position)
    this.rotMobBody = rotMobBody;    // Matrix3, rad/s per N·mm in the body (rest) frame
    this.rotMob = new Matrix3();     // in world frame
    this.F = new Vector3();
    this.T = new Vector3();
    this.prevPos = new Vector3();
    this.prevQ = new Quaternion();
    this.sync();
  }

  sync() {
    const m4 = _m4.makeRotationFromQuaternion(this.q);
    this.R.setFromMatrix4(m4);
    this.Rt.copy(this.R).transpose();
    this.rotMob.copy(this.R).multiply(this.rotMobBody).multiply(this.Rt);
  }

  apply(p, out) { return out.copy(p).sub(this.origin).applyMatrix3(this.R).add(this.pos); }
  applyPrev(p, out) { return out.copy(p).sub(this.origin).applyQuaternion(this.prevQ).add(this.prevPos); }
  toRest(x, out) { return out.copy(x).sub(this.pos).applyMatrix3(this.Rt).add(this.origin); }
  dir(v, out) { return out.copy(v).applyMatrix3(this.R); }

  addForce(x, f) {
    this.F.add(f);
    _a.copy(x).sub(this.pos).cross(f);
    this.T.add(_a);
  }

  /** effective inverse "mass" for a positional correction along n at world point x */
  w(x, n) {
    _a.copy(x).sub(this.pos).cross(n);
    _b.copy(_a).applyMatrix3(this.rotMob);
    return this.linMob + _a.dot(_b);
  }

  /** move by lambda along n applied at x (position-based correction) */
  correct(x, n, lambda) {
    if (this.linMob) this.pos.addScaledVector(n, lambda * this.linMob);
    _a.copy(x).sub(this.pos).cross(n).applyMatrix3(this.rotMob).multiplyScalar(lambda);
    rotate(this.q, _a);
    this.sync();
  }

  integrate(dt) {
    if (this.linMob) this.pos.addScaledVector(this.F, this.linMob * dt);
    _a.copy(this.T).applyMatrix3(this.rotMob).multiplyScalar(dt);
    rotate(this.q, _a);
    this.sync();
  }

  matrix(out) {
    // x = R (p - origin) + pos  ->  T(pos) * R * T(-origin)
    out.makeRotationFromQuaternion(this.q);
    _c.copy(this.origin).applyQuaternion(this.q);
    out.setPosition(this.pos.x - _c.x, this.pos.y - _c.y, this.pos.z - _c.z);
    return out;
  }
}

const _m4 = new Matrix4(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _q = new Quaternion();

/** rotate quaternion q by a small rotation vector v (world frame) */
function rotate(q, v) {
  const ang = v.length();
  if (ang < 1e-12) return;
  _q.setFromAxisAngle(_b.copy(v).divideScalar(ang), ang);
  q.premultiply(_q).normalize();
}

/** rotation vector (axis * angle) taking quaternion a to b, in world frame */
function rotvec(from, to, out) {
  _q.copy(from).invert().premultiply(to); // to * from^-1
  if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
  const s = Math.sqrt(_q.x * _q.x + _q.y * _q.y + _q.z * _q.z);
  if (s < 1e-9) return out.set(0, 0, 0);
  const ang = 2 * Math.atan2(s, _q.w);
  return out.set(_q.x, _q.y, _q.z).multiplyScalar(ang / s);
}

/** twist angle of q about unit axis a */
function twist(q, a) {
  const p = q.x * a.x + q.y * a.y + q.z * a.z;
  let ang = 2 * Math.atan2(p, q.w);
  if (ang > Math.PI) ang -= 2 * Math.PI;
  if (ang < -Math.PI) ang += 2 * Math.PI;
  return ang;
}

const V = a => new Vector3().fromArray(a);

export class FractureSim {
  constructor(meta, frac) {
    this.meta = meta;
    const L = meta.landmarks, A = meta.attach, B = meta.bodies, F = meta.fracture;
    this.settings = defaultSettings();
    this.attach = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, V(v)]));
    this.attach.iliopsoasPulley = this.attach.iliopectineal.clone().add(new Vector3(0, 12, 0));
    this.H = V(L.headCenter);
    this.shaft = V(L.shaftAxis).normalize();
    this.neckLat = V(L.neckAxisLateral).normalize();
    this.fxNormal = V(F.normal).normalize();
    this.fxPoint = V(F.point);

    // mobilities: distal body ~ 1 mm/s per N; rotation scaled by its inertia
    const mD = B.distal.mass;
    const I = new Matrix3().set(...B.distal.inertia.flat());
    const linMobD = 1.0;
    const rotD = I.clone().invert().multiplyScalar(mD * linMobD);
    this.D = new Body(V(B.distal.com), linMobD, rotD);
    this.P = new Body(this.H, 0, new Matrix3().multiplyScalar(0).identity().multiplyScalar(1 / 300));
    this.mD = mD;
    this.mP = Math.max(0.3, B.proximal.mass);
    this.comP = V(B.proximal.com);

    // signed distance fields and contact points
    const fx = F;
    this.sdfP = new SDF(frac.sdfProx, fx.sdfProx.dims, fx.sdfProx.origin, fx.sdfStep, fx.sdfUnit);
    this.sdfD = new SDF(frac.sdfDist, fx.sdfDist.dims, fx.sdfDist.origin, fx.sdfStep, fx.sdfUnit);
    const pts = arr => { const o = []; for (let i = 0; i < arr.length; i += 3) o.push(new Vector3(arr[i], arr[i + 1], arr[i + 2])); return o; };
    this.cpP = pts(frac.contactsProx);
    this.cpD = pts(frac.contactsDist);

    // anteromedial-inferior cortical corner at the fracture (for the support check)
    const am = new Vector3(0.65, 0.65, 0.35).normalize();
    let best = null, bs = -1e9;
    for (const p of this.cpD) {
      if (Math.abs(this.fxNormal.dot(_a.copy(p).sub(this.fxPoint))) > 2.5) continue;
      const sc = p.dot(am);
      if (sc > bs) { bs = sc; best = p; }
    }
    this.amCorner = best ? best.clone() : this.fxPoint.clone();
    this.amOut = am.clone().addScaledVector(this.fxNormal, -am.dot(this.fxNormal)).normalize();

    // muscle lines with intact lengths
    this.lines = [];
    for (const m of MUSCLES) {
      for (const l of m.lines) {
        const o = this.attach[l.from], ins = this.attach[l.to];
        this.lines.push({ muscle: m.id, name: m.name, origin: o, insertion: ins, body: l.body,
          L0: o.distanceTo(ins), length: 0, strain: 0, tension: 0, x: ins.clone() });
      }
    }
    this.heel = this.attach.heel.clone();
    this.foot = this.attach.foot.clone();
    this.heelY = this.heel.y;
    this.heelAnchor = null;

    // hands / holders
    // holds pull a fragment towards a target pose with a time constant tau (implicit, always stable).
    // A smaller tau = a firmer grip. Muscles still pull against the hold, so the result is a balance.
    this.footHold = { active: false, pos: new Vector3(), q: new Quaternion(), tau: 0.02 };
    this.pinHold = { active: false, q: new Quaternion(), tau: 0.03 };
    this.pushes = [];  // {body:'P'|'D', point (rest), dir (world unit), force N}
    this.tools = [];   // {tip: Vector3 world, radius}
    this.contactCount = 0;
    this.acc = 0;
    this.dt = 1 / 240;
    this.time = 0;
    this.frozen = false;
    this.v = Array.from({ length: 12 }, tmpV);
    this.gradTmp = new Vector3();
  }

  reset() {
    for (const b of [this.P, this.D]) { b.pos.copy(b.origin); b.q.identity(); b.sync(); }
    this.heelAnchor = null;
    this.time = 0;
  }

  // ---------- forces ----------
  forces() {
    const { P, D } = this, s = this.settings, t = s.tissue, v = this.v;
    P.F.set(0, 0, 0); P.T.set(0, 0, 0); D.F.set(0, 0, 0); D.T.set(0, 0, 0);
    // gravity (patient lies supine: gravity points posterior, -y)
    const g = G * t.gravity;
    D.addForce(D.pos, v[0].set(0, -this.mD * g, 0));
    P.addForce(P.apply(this.comP, v[1]), v[0].set(0, -this.mP * g, 0));
    // muscles (tension only)
    for (const l of this.lines) {
      const m = s.muscles[l.muscle];
      const body = l.body === 'P' ? P : D;
      body.apply(l.insertion, l.x);
      const dvec = v[2].copy(l.origin).sub(l.x);
      const len = dvec.length();
      const rest = m.rest * l.L0;
      l.length = len;
      l.strain = len / rest - 1;
      l.tension = Math.max(0, m.k * (len - rest));
      if (l.tension > 0) body.addForce(l.x, dvec.multiplyScalar(l.tension / len));
    }
    // hip capsule resists rotation of the head-neck fragment
    rotvec(P.q, _qI, v[3]);
    P.T.addScaledVector(v[3], t.capsule);
    // leg roll resistance about the shaft axis
    const tw = twist(D.q, this.shaft);
    D.T.addScaledVector(D.dir(this.shaft, v[4]), -t.legRoll * tw);
    // soft-tissue envelope (thigh muscles, periosteum) between the fragments at the fracture:
    // stiff sideways, soft along the shaft so the leg can still shorten
    const xp = P.apply(this.fxPoint, v[5]), xd = D.apply(this.fxPoint, v[6]);
    const ax = D.dir(this.shaft, v[4]);
    const f = v[7].copy(xp).sub(xd);
    const along = f.dot(ax);
    f.addScaledVector(ax, -along).multiplyScalar(t.tether).addScaledVector(ax, along * t.tetherAxial);
    D.addForce(xd, f);
    P.addForce(xp, f.negate());
    // heel on the support (one-sided) with friction
    const h = D.apply(this.heel, v[8]);
    if (!this.footHold.active && h.y < this.heelY) {
      const N = t.heelSupport * (this.heelY - h.y);
      D.addForce(h, v[9].set(0, N, 0));
      if (!this.heelAnchor) this.heelAnchor = new Vector3(h.x, 0, h.z);
      const ft = v[10].set(this.heelAnchor.x - h.x, 0, this.heelAnchor.z - h.z).multiplyScalar(2.0);
      const lim = t.heelFriction * N, fl = ft.length();
      if (fl > lim) {
        ft.multiplyScalar(lim / fl);
        this.heelAnchor.set(h.x, 0, h.z).addScaledVector(ft, 1 / 2.0);
      }
      D.addForce(h, ft);
    } else {
      this.heelAnchor = null;
    }
    // pushes (browser "ball spike / lever" sliders): constant forces on bone points
    for (const p of this.pushes) {
      if (!p.force) continue;
      const body = p.body === 'P' ? P : D;
      body.addForce(body.apply(p.point, v[11]), v[10].copy(p.dir).multiplyScalar(p.force));
    }
  }

  // ---------- contacts (position based, with friction) ----------
  contactPass() {
    const { P, D } = this, mu = this.settings.tissue.friction;
    let count = 0;
    count += this.pairPass(this.cpD, D, P, this.sdfP, mu);
    count += this.pairPass(this.cpP, P, D, this.sdfD, mu);
    this.contactCount = count;
    for (const tool of this.tools) {
      for (const [body, sdf] of [[P, this.sdfP], [D, this.sdfD]]) {
        const q = body.toRest(tool.tip, this.v[0]);
        const d = sdf.sample(q, this.gradTmp);
        if (d < tool.radius) {
          const n = body.dir(this.gradTmp, this.v[1]).normalize().negate(); // push body away from the tip
          const w = body.w(tool.tip, n);
          if (w > 0) body.correct(tool.tip, n, (tool.radius - d) / w);
        }
      }
    }
  }

  /** points of body A against the SDF of body B */
  pairPass(points, A, B, sdfB, mu) {
    const v = this.v;
    let count = 0;
    for (const p of points) {
      const x = A.apply(p, v[0]);
      const q = B.toRest(x, v[1]);
      const d = sdfB.sample(q, this.gradTmp);
      if (d >= 0) continue;
      count++;
      const n = B.dir(this.gradTmp, v[2]).normalize(); // outward of B: direction A must move
      const wA = A.w(x, n), wB = B.w(x, n);
      const lam = -d / (wA + wB);
      A.correct(x, n, lam);
      B.correct(x, n.clone().negate(), lam);
      // static / kinetic friction on the tangential slip during this step
      const xa = A.apply(p, v[3]);
      const xaPrev = A.applyPrev(p, v[4]);
      const qb = B.toRest(xa, v[5]);
      const xbPrev = B.applyPrev(qb, v[6]);
      // slip = motion of A's point minus motion of B's coincident material point = xbPrev - xaPrev
      const slip = v[7].copy(xbPrev).sub(xaPrev);
      slip.addScaledVector(n, -slip.dot(n));
      const sl = slip.length();
      if (sl > 1e-6) {
        const corr = Math.min(sl, mu * -d);
        const t = slip.multiplyScalar(-1 / sl);
        const wa = A.w(xa, t), wb = B.w(xa, t);
        const lt = corr / (wa + wb);
        A.correct(xa, t, lt);
        B.correct(xa, t.clone().negate(), lt);
      }
    }
    return count;
  }

  step(dt) {
    const { P, D } = this;
    for (const b of [P, D]) { b.prevPos.copy(b.pos); b.prevQ.copy(b.q); }
    this.forces();
    P.integrate(dt);
    D.integrate(dt);
    const fh = this.footHold, ph = this.pinHold;
    if (fh.active) {
      const a = 1 - Math.exp(-dt / fh.tau);
      D.pos.lerp(fh.pos, a);
      D.q.slerp(fh.q, a);
      D.sync();
    }
    if (ph.active) {
      P.q.slerp(ph.q, 1 - Math.exp(-dt / ph.tau));
      P.sync();
    }
    for (let i = 0; i < 2; i++) this.contactPass();
    this.time += dt;
  }

  /** advance by frame time (fixed substeps) */
  update(frameDt) {
    if (this.frozen) return;
    this.acc = Math.min(this.acc + frameDt, 0.1);
    let n = 0;
    while (this.acc >= this.dt && n < 8) { this.step(this.dt); this.acc -= this.dt; n++; }
  }

  settle(seconds) {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.step(this.dt);
  }

  matrixP(out = new Matrix4()) { return this.P.matrix(out); }
  matrixD(out = new Matrix4()) { return this.D.matrix(out); }

  // ---------- holds set from VR / browser controls (all in the patient frame) ----------
  /** distal fragment pose as {pos, q} */
  poseD() { return { pos: this.D.pos.clone(), q: this.D.q.clone() }; }
  poseP() { return this.P.q.clone(); }

  holdFoot(pos, q, tau = 0.02) { const h = this.footHold; h.active = true; h.pos.copy(pos); h.q.copy(q); h.tau = tau; }
  releaseFoot() { this.footHold.active = false; }
  holdPin(q, tau = 0.03) { const h = this.pinHold; h.active = true; h.q.copy(q); h.tau = tau; }
  releasePin() { this.pinHold.active = false; }
  releaseAll() { this.releaseFoot(); this.releasePin(); for (const p of this.pushes) p.force = 0; this.tools.length = 0; }

  // ---------- clinical measures ----------
  measures() {
    const { P, D } = this, v = this.v;
    const neck = P.dir(this.neckLat, v[0]).negate();   // towards the head
    const shaft = D.dir(this.shaft, v[1]);             // distal
    const angXZ = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / Math.hypot(a.x, a.z) / Math.hypot(b.x, b.z))));
    const nsa = angXZ(neck, shaft) * 180 / Math.PI;
    const neck0 = v[2].copy(this.neckLat).negate();
    const nsa0 = angXZ(neck0, this.shaft) * 180 / Math.PI;
    const lt = D.apply(this.attach.lt, v[3]);
    const shortening = -lt.sub(this.attach.lt).dot(this.shaft);
    const rot = twist(D.q, this.shaft) * 180 / Math.PI;       // + = external rotation (right leg)
    const dp = D.apply(this.fxPoint, v[4]).sub(P.apply(this.fxPoint, v[5]));
    const sag = -dp.y;                                         // + = distal fragment posterior
    const qp = P.apply(this.amCorner, v[6]), qd = D.apply(this.amCorner, v[7]);
    const rel = qp.sub(qd);
    const amShift = rel.dot(P.dir(this.amOut, v[8]));          // + = head-neck cortex outside the shaft cortex
    const gap = rel.dot(P.dir(this.fxNormal, v[9]));           // + = fragments apart at that corner
    let amcs = 'neutral';
    if (gap > 2.5) amcs = 'no contact';
    else if (amShift > 1.5) amcs = 'positive';
    else if (amShift < -1.5) amcs = 'negative';
    return { nsa, nsa0, varus: nsa0 - nsa, shortening, rotation: rot, sag, amShift, gap, amcs, contacts: this.contactCount };
  }
}

const _qI = new Quaternion();
