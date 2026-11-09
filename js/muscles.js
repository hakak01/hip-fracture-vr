// Muscle springs and soft-tissue settings. THIS IS THE FILE TO TUNE.
// Each muscle is a tension-only spring from a pelvic origin to an insertion on a fragment.
//   k     stiffness in newtons per millimetre of stretch
//   rest  rest length as a fraction of the intact anatomical length (below 1 = tension when intact)
// Attachment names refer to "attach" points computed from the CT (assets/ct/meta.json).
// "P" = proximal (head-neck) fragment, "D" = distal fragment (shaft, lesser trochanter, whole leg).

export const MUSCLES = [
  { id: 'gmed', name: 'Gluteus medius', k: 6.0, rest: 0.88,
    lines: [{ from: 'iliumOuter', to: 'gtLatFacet', body: 'P' }] },
  { id: 'gmin', name: 'Gluteus minimus', k: 3.0, rest: 0.94,
    lines: [{ from: 'iliumLower', to: 'gtAntFacet', body: 'P' }] },
  { id: 'ser', name: 'Short external rotators', k: 1.0, rest: 0.94,
    lines: [{ from: 'sacrumAnt', to: 'gtTip', body: 'P' }, { from: 'ischialSpine', to: 'trochFossa', body: 'P' }] },
  { id: 'ilio', name: 'Iliopsoas', k: 1.5, rest: 0.93,
    lines: [{ from: 'iliopsoasPulley', to: 'lt', body: 'D' }] },
  { id: 'add', name: 'Adductors', k: 3.0, rest: 0.92,
    lines: [{ from: 'pubicBody', to: 'lineaAspera', body: 'D' }, { from: 'ischiopubic', to: 'adductorTubercle', body: 'D' }] },
  { id: 'ham', name: 'Hamstrings', k: 2.5, rest: 0.93,
    lines: [{ from: 'ischialTub', to: 'tibiaPost', body: 'D' }] },
  { id: 'quad', name: 'Quadriceps', k: 2.5, rest: 0.93,
    lines: [{ from: 'aiis', to: 'tibialTub', body: 'D' }] },
];

// Other soft tissues and the environment.
export const TISSUE = {
  gravity: 1.0,        // x 9.81 m/s^2
  friction: 0.6,       // bone-on-bone friction coefficient at the fracture
  capsule: 8000,       // N·mm/rad, hip capsule resisting rotation of the head-neck fragment
  legRoll: 2000,       // N·mm/rad, resistance of the leg to rolling about its long axis
  tether: 14,          // N/mm, soft-tissue envelope holding the shaft sideways against the head-neck fragment
  tetherAxial: 0.3,    // N/mm, the same envelope along the shaft (low, so the leg can shorten)
  heelSupport: 30,     // N/mm, heel resting on the leg support
  heelFriction: 0.25,  // heel friction on the support
};

export function defaultSettings() {
  return {
    muscles: Object.fromEntries(MUSCLES.map(m => [m.id, { k: m.k, rest: m.rest }])),
    tissue: { ...TISSUE },
  };
}
