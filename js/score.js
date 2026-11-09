// Scoring of the guidewire position.
// Tip-apex distance (Baumgaertner MR et al., J Bone Joint Surg Am 1995;77:1058-64): distance from the
// wire tip to the apex of the femoral head on the AP view plus the same on the lateral view, corrected
// for magnification (here measured on the true geometry). Aim: under 25 mm.
// Cleveland zones (Cleveland M et al., J Bone Joint Surg Am 1959;41:1399-1408): the head is divided into
// thirds on the AP (superior / centre / inferior) and on the lateral (anterior / centre / posterior);
// zones 1-9, zone 5 = centre-centre, zone 8 = inferior-centre.
import * as THREE from 'three';

const ROWS = ['superior', 'centre', 'inferior'];
const COLS = ['anterior', 'centre', 'posterior'];

export function scoreWire(sim, dhs, fracView) {
  if (!dhs.wire.inGuide || dhs.wire.depth <= 0) return null;
  const mP = fracView.mP;
  const r = sim.meta.landmarks.headRadius;
  const H = sim.H.clone().applyMatrix4(mP);                                    // head centre now
  const axis = sim.neckLat.clone().negate().transformDirection(mP);           // neck axis towards the head
  const tip = dhs.tipPatient();

  // AP view (beam antero-posterior): coordinates (x, z)
  const ap = v => new THREE.Vector2(v.x, v.z);
  const axAP = ap(axis).normalize();
  const apexAP = ap(H).addScaledVector(axAP, r);
  const tipAP = ap(tip);
  const tadAP = tipAP.distanceTo(apexAP);
  let supAP = new THREE.Vector2(-axAP.y, axAP.x);
  if (supAP.y > 0) supAP.negate();                                            // superior = -z
  const vAP = tipAP.clone().sub(ap(H)).dot(supAP);

  // true lateral of the neck (horizontal beam perpendicular to the neck)
  const eh = new THREE.Vector3(axis.x, 0, axis.z).normalize();
  const lat = v => new THREE.Vector2(v.dot(eh), v.y);
  const axL = lat(axis).normalize();
  const apexL = lat(H).addScaledVector(axL, r);
  const tipL = lat(tip);
  const tadLat = tipL.distanceTo(apexL);
  let antL = new THREE.Vector2(-axL.y, axL.x);
  if (antL.y < 0) antL.negate();                                              // anterior = +y
  const vL = tipL.clone().sub(lat(H)).dot(antL);

  const third = r / 3;
  const row = vAP > third ? 0 : vAP < -third ? 2 : 1;
  const col = vL > third ? 0 : vL < -third ? 2 : 1;
  const zone = row * 3 + col + 1;

  const info = dhs.tipInfo();
  const fromCentre = tip.distanceTo(H);
  const toSurface = r - fromCentre;
  const tad = tadAP + tadLat;
  const goodZone = zone === 5 || zone === 8;
  const problems = [];
  if (dhs.perforated) problems.push('wire has perforated the head into the joint');
  else if (info.where !== 'proximal') problems.push('tip is not in the femoral head');
  if (tad >= 25) problems.push(`tip-apex distance ${tad.toFixed(0)} mm (aim < 25 mm)`);
  if (!goodZone) problems.push(`zone ${zone} (${ROWS[row]}-${COLS[col]}); aim for zone 5 or 8`);
  let grade = 'Good';
  if (dhs.perforated || info.where !== 'proximal' || tad >= 30 || row === 0 || col === 0) grade = 'Poor — high cut-out risk';
  else if (problems.length) grade = 'Acceptable';
  return {
    tad, tadAP, tadLat, zone, zoneName: `${ROWS[row]}-${COLS[col]}`, toSurface, grade, problems,
    passes: dhs.passes, perforated: dhs.perforated,
  };
}

export function scoreLines(sc, m, shots, seconds) {
  if (!sc) return ['No guidewire in the head yet.'];
  return [
    `${sc.grade}`,
    `TAD ${sc.tad.toFixed(1)} mm (AP ${sc.tadAP.toFixed(1)} + LAT ${sc.tadLat.toFixed(1)})`,
    `Cleveland zone ${sc.zone} (${sc.zoneName}) · tip ${Math.max(0, sc.toSurface).toFixed(0)} mm from subchondral bone`,
    `Reduction: neck–shaft ${m.nsa.toFixed(0)}° · AM support ${m.amcs} · wire passes ${sc.passes} · X-rays ${shots} (${seconds.toFixed(1)} s)`,
  ];
}
