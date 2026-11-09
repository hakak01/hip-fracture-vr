# Hip Fracture VR Trainer — Project Brief

## About me
I'm an orthopaedic surgeon with no programming experience. I work only from my phone and a Meta Quest 3, with no laptop. Use simple English, keep replies short, and tell me exactly what to tap whenever I need to do something.

## Goal
A realistic VR trainer for a trochanteric fracture: reduce the fracture, then place the DHS guidewire.

## Platform
- One web app (three.js + WebXR), hosted free on GitHub Pages from this public repo (hakak01/hip-fracture-vr). First, tell me how to switch Pages on.
- It must open in a normal phone or laptop browser with touch/mouse controls, and on Quest 3 with an Enter VR button. Inside VR there must be an Exit VR button.
- It must run smoothly on Quest 3 without a PC. Keep the total download small.
- Put finished work on the main branch so the Pages link updates. If you can only open a pull request, tell me which button to tap to merge it.

## Anatomy
- Use ONE real CT of the pelvis and proximal femur from an open dataset whose licence allows sharing in a public repo. Tell me which scan and which licence before using it. If the download is blocked, tell me exactly which setting to change.
- From that same CT, make realistic pelvis and femur models and a skin surface. Skin on/off switch plus a fade slider.
- Left or right side choice (mirror everything).

## C-arm
- A monitor in the room with AP and lateral buttons, like a real C-arm screen.
- Images computed from the CT itself (DRR). Each fragment's bone moves with that fragment, so the shots look like real fluoroscopy.

## Fracture and physics (version 1)
- One AO 31A1 two-part pertrochanteric fracture, cut from the CT bone. The lesser trochanter stays with the distal fragment.
- Muscle springs: each main muscle is a spring between its real attachment points (gluteus medius and minimus, iliopsoas, short external rotators, adductors, hamstrings, quadriceps), plus gravity. Fragments are rigid and cannot pass through each other. The deformity must come from these forces, not from a script.
- Each muscle line changes colour as it stretches. Add a hidden tuning panel for muscle stiffness and rest length, so that when I say "too much varus", you can adjust it.

## My controls
- In VR: grab the foot to pull (traction), twist it (rotation) and swing it (abduction/adduction). Grab a Schanz pin in the proximal fragment to steer it. Grab a lever or ball spike to push.
- In the browser: on-screen controls that do the same things.
- An Auto-reduce button with a choice of a good reduction or one with a common mistake: leftover varus, posterior sag, or a gap.

## Guidewire (after reduction)
- DHS guidewire with a 135° angle guide on the lateral cortex. I can drill it in, withdraw it completely and re-insert it.
- Check the wire on AP and lateral C-arm views. Score tip-apex distance (aim under 25 mm) and Cleveland zone.

## Milestones (stop after each one so I can test on my phone and Quest)
1. Scene, CT bones and skin, skin switch, side choice, C-arm monitor with AP/lateral, Enter/Exit VR.
2. Fracture, muscle springs, my controls, Auto-reduce.
3. DHS guidewire and scoring.

Later, not now: PFN entry point, AO 31A2 and 31A3, then a separate lumbar spine trainer.

---

## Progress
- Milestone 1: done (Nov 2026). CT: TotalSegmentator s0774 (CC BY 4.0), approved by me.
- Milestone 2: done (Nov 2026). Added on request: 30° anteromedial oblique C-arm view to check anteromedial cortical support.
- Milestone 3: done (Nov 2026). Added on request: oblique images on the lateral screen (two screens only); movable C-arm with images from its real position; extra realism (laser, pedal, sounds, vibration, drilling resistance, perforation warning, metal on fluoroscopy).
