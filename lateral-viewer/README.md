# Lateral C-arm viewer — trochanteric fracture malreductions

A browser page that shows, side by side, a 3D bone model and the matching C-arm image (lateral, or AP) for
common malreductions of an AO/OTA 31-A1 two-part trochanteric fracture on a traction table.
Both come from the same CT and the same fragment positions, so they always agree.

**Live page:** https://hakak01.github.io/hip-fracture-vr/lateral-viewer/

Not for clinical use. Separate from the VR trainer in the repository root, which is unchanged.

## How to use
- **Preset** (top): pick a malreduction; the **Mild ↔ Severe** slider sets how much.
- **3D**: drag to turn, pinch to zoom. **Beam view** snaps the camera to the exact C-arm beam direction;
  **Reset** goes back. **Colour fragments** (orange = head-neck, blue = shaft), **See-through** makes one
  fragment transparent, **Show beam** draws the X-ray cone.
- **C-arm**: **Lateral** (horizontal beam, perpendicular to the neck) or **AP**. **Tilt** turns the lateral beam
  in the horizontal plane to line it up with the neck. **Invert** swaps black and white.
- The box under the controls says what is wrong, how to spot it on the lateral view, and the numbers measured
  from the anatomical position (anterior cortex step at the anteromedial cortex, shaft shift, angulation,
  rotation, neck fragment flexion and version).

## How it is made
- **CT**: autoPET / FDG-PET-CT-Lesions, patient PETCT_d3dac0d1cd (woman, 75 years), whole-body CT with 1 mm slices
  every 0.7 mm, 0.86 mm pixels. Licence CC BY 4.0. Gatidis S, Hepp T, Früh M, et al. *A whole-body FDG-PET/CT
  dataset with manually annotated tumor lesions.* Sci Data 2022;9:601.
  [doi:10.1038/s41597-022-01718-3](https://doi.org/10.1038/s41597-022-01718-3). Downloaded from the NCI
  Imaging Data Commons. No bone lesion, implant, fracture or severe arthritis at the hips.
- **Measured anatomy (right femur)**: neck-shaft angle 130°; anteversion 15° (neck axis vs posterior condylar
  line, viewed along the head-centre → knee-centre axis; 20° if viewed along the proximal shaft axis).
  Torsion values depend on the CT method: Kaiser P et al. Arch Orthop Trauma Surg 2016;136:1259-64,
  [doi:10.1007/s00402-016-2536-3](https://doi.org/10.1007/s00402-016-2536-3).
- **Bone masks**: TotalSegmentator (Wasserthal J et al. Radiol Artif Intell 2023;5:e230024), refined with the CT.
- **Changes made to the CT**: vessel contrast and the PET-CT table removed; the right leg turned about the femoral
  head centre to the traction-table position (hip extended, patella up, then 15° internal rotation so the neck is
  about level) with the bone moved rigidly and the soft tissue following the nearest bone smoothly; the left thigh
  lifted out of the beam (removed beyond a rounded stump below the left hip); AO 31-A1 fracture cut from the CT
  and the mesh (lateral wall intact, lesser trochanter on the shaft fragment, slightly rough surface); volume
  cropped and quantised at three detail levels (0.8 mm around the proximal femur and acetabulum, 1.6 mm for
  the other bones the beams can see, 3.2 mm for soft tissue).
- **X-ray**: digitally reconstructed radiograph — GPU ray-casting through the CT voxels (Beer-Lambert line
  integral, bone attenuation scaled for a ~70 kV beam), then C-arm processing (harmonisation, edge enhancement,
  automatic contrast in the centre of the field, noise, vignetting, round 12-inch field; SID 1000 mm,
  source to isocentre 620 mm). Adapted from `../js/drr.js`.
- **Fragments**: the head-neck fragment can only turn about the femoral head centre (the head stays in the
  acetabulum); the shaft can move freely.
- [three.js](https://threejs.org) r176 (MIT), loaded from `../lib/three/`.

## Files
- `index.html`, `css/`, `js/` — the page (`drr.js` X-ray, `view3d.js` 3D model and beam, `presets.js` fragment
  motions, measurements and labels, `assets.js` loader, `main.js` controls).
- `assets/` — `bones.glb` (meshes), `vol_fine/mid/coarse.bin.gz` (CT levels), `meta.json` (landmarks, geometry).
- `tools/` — rebuild the assets (Python: numpy, scipy, nibabel, scikit-image, trimesh, fast-simplification,
  pydicom, idc-index, TotalSegmentator):
  1. `python fetch_ct.py <work>` — download the CT from IDC and segment the bones.
  2. `python build_assets.py <work> <work>/out`
  3. `gltfpack -i <work>/out/bones_raw.glb -o <work>/out/bones.glb -cc -kn -km`, then copy `bones.glb`,
     `meta.json` and `vol_*.bin.gz` into `assets/`.
  `build_assets.py` and `fracture.py` are adapted from `../tools/`; `anatomy.py` measures the femur;
  `warp.py` positions the legs.
