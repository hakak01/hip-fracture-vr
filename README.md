# Hip Fracture VR Trainer

A browser and Meta Quest 3 (WebXR) trainer for a trochanteric hip fracture: reduce the fracture, then place the DHS guidewire.
Built with three.js. No install, no build step. See [PLAN.md](PLAN.md) for the full brief and milestones.

**Live app:** https://hakak01.github.io/hip-fracture-vr/ (after GitHub Pages is switched on)

Not for clinical use.

## Status
- Milestone 1 — done: operating room, CT bones and skin, skin switch and fade, left/right side, C-arm with AP and lateral images computed from the CT (DRR), Enter/Exit VR.
- Milestone 2 — done: AO 31A1 two-part pertrochanteric fracture cut from the CT (lesser trochanter on the distal fragment); muscle springs between CT-derived attachment points plus gravity; fragments collide with friction; deformity comes from the forces; muscle lines coloured by stretch; hidden tuning panel; foot, Schanz pin, ball spike and bone lever (VR) or sliders (browser); Auto-reduce (good, leftover varus, posterior sag, gap); 30° anteromedial oblique C-arm view.
- Milestone 3 — next: DHS guidewire and scoring.

## Controls
- **Phone / laptop:** drag to turn the view, pinch or scroll to zoom, two fingers to pan. Tabs at the bottom: *C-arm* (AP, Lateral, Oblique 30°), *Reduce* (foot, Schanz pin and push sliders), *Auto* (Auto-reduce, Restart fracture), *View* (skin, muscles, side). Tap the X-ray thumbnails to enlarge them.
- **Quest 3:** tap *Enter VR*. Point at a button and pull the trigger. Squeeze the grip button on the boot (foot), the blue T-handle (Schanz pin) or a tool on the tray (ball spike, bone lever). Let go of the boot and it stays locked; let go of the pin and an assistant holds it. *Free leg* / *Free pin* on the Reduction panel release them. Left stick walks, right stick turns. *Exit VR* is on the Controls panel.
- **Tuning panel (hidden):** tap the *Hip VR* title three times (or add `?tune` to the address). Muscle stiffness and rest length, soft-tissue settings, live neck–shaft angle, shortening, rotation, sag and anteromedial support. *Copy settings* copies the numbers so they can be sent back. Default values live in `js/muscles.js`.

## CT data and credits
- CT case **s0774** (female, 75 years, CT angiography pelvis–leg) from the **TotalSegmentator dataset v2.0.1**,
  Wasserthal J, Breit H-C, Meyer MT, et al. *TotalSegmentator: robust segmentation of 104 anatomic structures in CT images.*
  Radiology: Artificial Intelligence 2023;5(5):e230024. Data: [doi:10.5281/zenodo.10047292](https://doi.org/10.5281/zenodo.10047292).
  Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  **Changes made:** cropped and reoriented; vessel and bladder contrast removed; skin cut off by the scan edge at the outer hips filled with a smooth rounded surface;
  bone and skin surfaces extracted and simplified; the left leg is shown lowered and draped; volume quantised for the X-ray simulation.
- [three.js](https://threejs.org) r176 (MIT licence), in `lib/three/`.
- 30° anteromedial oblique view: Chen SY, Chang SM, Tuladhar R, et al. *A new fluoroscopic view for evaluation of anteromedial cortex reduction quality during cephalomedullary nailing for intertrochanteric femur fractures: the 30° oblique tangential projection.* BMC Musculoskelet Disord 2020;21:719. [doi:10.1186/s12891-020-03668-6](https://doi.org/10.1186/s12891-020-03668-6)

## Files
- `index.html`, `css/`, `js/` — the app.
- `assets/ct/` — `anatomy.glb` (bone and skin meshes), `volume.bin.gz` (CT volume for the X-ray images), `fracture.bin.gz` (fragment distance fields and contact points), `meta.json` (landmarks, muscle attachments, fracture plane).
- `js/physics.js` (fragments, contacts, holds), `js/muscles.js` (muscle and soft-tissue settings), `js/reduce.js` (sliders, Auto-reduce), `js/fracture.js` (fragment display, muscle lines, skin), `js/tools.js` (VR instruments), `js/tuning.js` (hidden panel).
- `tools/build_assets.py` + `tools/fracture.py` — rebuild `assets/ct/` from the CT (Python: numpy, scipy, nibabel, scikit-image, trimesh, fast-simplification; then `gltfpack -cc -kn -km`).

Patient frame used in the data: millimetres, +x patient left, +y anterior, +z inferior, origin midway between the femoral head centres. The data is a right hip; a left hip is shown by mirroring.
