# Hip Fracture VR Trainer

A browser and Meta Quest 3 (WebXR) trainer for a trochanteric hip fracture: reduce the fracture, then place the DHS guidewire.
Built with three.js. No install, no build step. See [PLAN.md](PLAN.md) for the full brief and milestones.

**Live app:** https://hakak01.github.io/hip-fracture-vr/ (after GitHub Pages is switched on)

Not for clinical use.

## Status
- Milestone 1 — done: operating room, CT bones and skin, skin switch and fade, left/right side, C-arm with AP and lateral images computed from the CT (DRR), Enter/Exit VR.
- Milestone 2 — next: fracture, muscle springs, controls, Auto-reduce.
- Milestone 3 — later: DHS guidewire and scoring.

## Controls
- **Phone / laptop:** drag to turn the view, pinch or scroll to zoom, two fingers to pan. Buttons at the bottom. Tap the X-ray thumbnails to enlarge them.
- **Quest 3:** tap *Enter VR*. Point the controller (or pinch with your hand) at a button and pull the trigger. Left stick walks, right stick turns. The *Controls* panel next to you has *Exit VR*.

## CT data and credits
- CT case **s0774** (female, 75 years, CT angiography pelvis–leg) from the **TotalSegmentator dataset v2.0.1**,
  Wasserthal J, Breit H-C, Meyer MT, et al. *TotalSegmentator: robust segmentation of 104 anatomic structures in CT images.*
  Radiology: Artificial Intelligence 2023;5(5):e230024. Data: [doi:10.5281/zenodo.10047292](https://doi.org/10.5281/zenodo.10047292).
  Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  **Changes made:** cropped and reoriented; vessel and bladder contrast removed; skin cut off by the scan edge at the outer hips filled with a smooth rounded surface;
  bone and skin surfaces extracted and simplified; the left leg is shown lowered and draped; volume quantised for the X-ray simulation.
- [three.js](https://threejs.org) r176 (MIT licence), in `lib/three/`.

## Files
- `index.html`, `css/`, `js/` — the app.
- `assets/ct/` — `anatomy.glb` (bone and skin meshes), `volume.bin.gz` (CT volume for the X-ray images), `meta.json` (landmarks).
- `tools/build_assets.py` — rebuilds `assets/ct/` from the CT (Python: numpy, scipy, nibabel, scikit-image, trimesh, fast-simplification; then `gltfpack -cc -kn -km`).

Patient frame used in the data: millimetres, +x patient left, +y anterior, +z inferior, origin midway between the femoral head centres. The data is a right hip; a left hip is shown by mirroring.
