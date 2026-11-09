// Reduction: browser sliders and Auto-reduce. Both work by setting "holds" (hands on the foot and
// on the Schanz pin) and pushes; the physics then finds where the fragments end up against the muscles.
// All in the unmirrored patient frame (mm). Signs are for the anatomical right hip.
import { Vector3, Quaternion } from 'three';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const deg = d => d * Math.PI / 180;
const smooth = t => t * t * (3 - 2 * t);

function rotAbout(pose, centre, q) {
  pose.pos.sub(centre).applyQuaternion(q).add(centre);
  pose.q.premultiply(q);
  return pose;
}

export const AUTO_CHOICES = [
  { id: 'good', label: 'Good reduction' },
  { id: 'varus', label: 'Leftover varus' },
  { id: 'sag', label: 'Posterior sag' },
  { id: 'gap', label: 'Gap' },
];

export const SLIDERS = [
  { id: 'traction', label: 'Traction', unit: 'mm', min: 0, max: 60, group: 'Foot' },
  { id: 'rot', label: 'Rotation (− int / + ext)', unit: '°', min: -60, max: 60, group: 'Foot' },
  { id: 'abd', label: 'Abduction (− add)', unit: '°', min: -20, max: 30, group: 'Foot' },
  { id: 'pflex', label: 'Flexion (− ext)', unit: '°', min: -30, max: 30, group: 'Schanz pin' },
  { id: 'pvv', label: 'Valgus (− varus)', unit: '°', min: -25, max: 25, group: 'Schanz pin' },
  { id: 'prot', label: 'Rotation (− int / + ext)', unit: '°', min: -40, max: 40, group: 'Schanz pin' },
  { id: 'lift', label: 'Lever: lift shaft', unit: 'N', min: 0, max: 200, group: 'Push' },
  { id: 'push', label: 'Ball spike: push neck back', unit: 'N', min: 0, max: 200, group: 'Push' },
];

export class Reducer {
  constructor(sim) {
    this.sim = sim;
    const m = sim.meta, L = m.landmarks;
    this.H = sim.H.clone();
    this.shaft = sim.shaft.clone();
    this.knee = new Vector3().fromArray(L.kneeCenter);
    this.fxMed = new Vector3().fromArray(m.fracture.fxMed);
    this.values = Object.fromEntries(SLIDERS.map(s => [s.id, 0]));
    this.ref = null;
    this.anim = null;
    this.status = '';
    // push points: posterior cortex of the shaft just below the fracture; anterior surface of the neck
    const neckPt = this.H.clone().addScaledVector(sim.neckLat, L.headRadius + 10);
    this.liftPush = { body: 'D', point: sim.fxPoint.clone().addScaledVector(this.shaft, 25).add(new Vector3(0, -16, 0)), dir: Y.clone(), force: 0 };
    this.neckPush = { body: 'P', point: neckPt.add(new Vector3(0, 14, 0)), dir: Y.clone().negate(), force: 0 };
    sim.pushes.push(this.liftPush, this.neckPush);
  }

  // ---------- sliders ----------
  captureRef() {
    const s = this.sim;
    this.ref = { pos: s.D.pos.clone(), q: s.D.q.clone(), pq: s.P.q.clone() };
  }

  setSlider(id, v) {
    if (!this.ref) this.captureRef();
    this.anim = null;
    this.values[id] = v;
    this.applySliders();
  }

  applySliders() {
    const v = this.values, s = this.sim, r = this.ref;
    const footActive = v.traction || v.rot || v.abd;
    const pinActive = v.pflex || v.pvv || v.prot;
    if (footActive) {
      const pose = { pos: r.pos.clone(), q: r.q.clone() };
      pose.pos.addScaledVector(this.shaft.clone().applyQuaternion(r.q), v.traction);
      const footW = s.foot.clone().sub(s.D.origin).applyQuaternion(r.q).add(r.pos);
      const mech = footW.sub(this.H).normalize();
      rotAbout(pose, this.H, new Quaternion().setFromAxisAngle(mech, deg(v.rot)));
      rotAbout(pose, this.H, new Quaternion().setFromAxisAngle(Y, deg(-v.abd)));
      s.holdFoot(pose.pos, pose.q, 0.01);
    }
    if (pinActive) {
      const q = r.pq.clone();
      q.premultiply(new Quaternion().setFromAxisAngle(Z, deg(v.prot)));
      q.premultiply(new Quaternion().setFromAxisAngle(Y, deg(v.pvv)));
      q.premultiply(new Quaternion().setFromAxisAngle(X, deg(-v.pflex)));
      s.holdPin(q, 0.015);
    }
    this.liftPush.force = v.lift;
    this.neckPush.force = v.push;
  }

  releaseAll() {
    for (const k of Object.keys(this.values)) this.values[k] = 0;
    this.ref = null;
    this.anim = null;
    this.status = '';
    this.sim.releaseAll();
  }

  // ---------- Auto-reduce ----------
  target(kind) {
    const s = this.sim;
    const pose = { pos: s.D.origin.clone(), q: new Quaternion() };
    const pq = new Quaternion();
    if (kind === 'varus') {
      // shaft swung into adduction about the medial cortex hinge: neck-shaft angle 10° smaller, lateral gap
      rotAbout(pose, this.fxMed, new Quaternion().setFromAxisAngle(Y, deg(10)));
    } else if (kind === 'sag') {
      // shaft dropped posteriorly at the fracture (about 10 mm), hinging at the knee
      const lever = this.knee.z - s.fxPoint.z;
      rotAbout(pose, this.knee, new Quaternion().setFromAxisAngle(X, -Math.asin(10 / lever)));
    } else if (kind === 'gap') {
      // over-traction: fragments pulled about 7 mm apart
      pose.pos.addScaledVector(this.shaft, 7);
    }
    return { pos: pose.pos, q: pose.q, pq };
  }

  autoReduce(kind, duration = 2.5) {
    const s = this.sim;
    for (const k of Object.keys(this.values)) this.values[k] = 0;
    this.liftPush.force = 0;
    this.neckPush.force = 0;
    s.tools.length = 0;
    this.ref = null;
    const t = this.target(kind);
    this.anim = {
      kind, t: 0, duration,
      from: { pos: s.D.pos.clone(), q: s.D.q.clone(), pq: s.P.q.clone() },
      to: t,
    };
    this.status = 'Reducing…';
  }

  update(dt) {
    const a = this.anim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.duration);
    const k = smooth(a.t);
    const pos = a.from.pos.clone().lerp(a.to.pos, k);
    const q = a.from.q.clone().slerp(a.to.q, k);
    const pq = a.from.pq.clone().slerp(a.to.pq, k);
    this.sim.holdFoot(pos, q, 0.003);
    this.sim.holdPin(pq, 0.002);
    if (a.t >= 1) {
      this.status = AUTO_CHOICES.find(c => c.id === a.kind).label + ' — held';
      this.anim = null;
    }
  }
}
