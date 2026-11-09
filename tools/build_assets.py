"""Build the web assets (bone/skin meshes, DRR volume, landmarks) from one CT.

Source: TotalSegmentator dataset v2.0.1, case s0774 (CC BY 4.0),
Wasserthal J. et al., Radiology: Artificial Intelligence 2023;5(5):e230024,
doi:10.5281/zenodo.10047292.

Usage:  python build_assets.py <case_dir> <out_dir> <tmp_dir>
  case_dir contains ct.nii.gz and segmentations/*.nii.gz
Outputs (out_dir): anatomy_raw.glb (compress later with gltfpack), volume.bin.gz, meta.json

Patient frame used everywhere (millimetres):
  +x = patient LEFT, +y = ANTERIOR, +z = INFERIOR (head is -z),
  origin = midpoint between the two femoral head centres.
The operated side in the data is the patient's RIGHT (x < 0). The app mirrors x for a left hip.
"""
import gzip
import json
import os
import sys

import fast_simplification
import nibabel as nib
import numpy as np
import scipy.ndimage as ndi
import trimesh
from skimage import measure

SP = 1.5  # voxel size (mm) of the dataset


def load(path, dtype=np.uint8):
    im = nib.as_closest_canonical(nib.load(path))  # RAS+: i -> Right, j -> Anterior, k -> Superior
    a = np.asanyarray(im.dataobj)
    a = a[::-1, :, ::-1]  # -> i -> Left, j -> Anterior, k -> Inferior
    return np.ascontiguousarray(a.astype(dtype))


def ball(r):
    g = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (g ** 2).sum(0) <= r * r


def largest_cc(m):
    lab, n = ndi.label(m)
    if n <= 1:
        return m
    sizes = ndi.sum(m, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def fill_holes_axial(m):
    out = np.empty_like(m)
    for k in range(m.shape[2]):
        out[:, :, k] = ndi.binary_fill_holes(m[:, :, k])
    return out


def mesh_from_mask(mask, origin_mm, target_tris, sigma=1.0, step=1, level=0.5):
    """Smooth a binary mask, run marching cubes, simplify. Returns (verts_mm, faces)."""
    f = ndi.gaussian_filter(mask.astype(np.float32), sigma)
    f = np.pad(f, 2)
    if step > 1:
        f = f[::step, ::step, ::step]
    v, fc, _, _ = measure.marching_cubes(f, level, spacing=(SP * step,) * 3)
    v = v - 2 * SP + origin_mm  # undo padding, move to patient frame
    fc = fc[:, ::-1]  # outward winding for three.js (counter-clockwise front faces)
    if len(fc) > target_tris:
        v, fc = fast_simplification.simplify(v.astype(np.float32), fc.astype(np.int32),
                                             target_reduction=1 - target_tris / len(fc))
    m = trimesh.Trimesh(v, fc, process=True)
    trimesh.smoothing.filter_taubin(m, iterations=6)
    return m


def sphere_fit(pts):
    A = np.c_[2 * pts, np.ones(len(pts))]
    b = (pts ** 2).sum(1)
    c, *_ = np.linalg.lstsq(A, b, rcond=None)
    ctr = c[:3]
    r = np.sqrt(c[3] + (ctr ** 2).sum())
    return ctr, r


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def main(case, out, tmp):
    os.makedirs(out, exist_ok=True)
    seg = lambda n: load(f"{case}/segmentations/{n}.nii.gz")
    ct = load(f"{case}/ct.nii.gz", np.int16)
    shape = ct.shape
    print("CT", shape)

    fem_r, fem_l = seg("femur_right"), seg("femur_left")
    pelvis_parts = ["hip_right", "hip_left", "sacrum", "vertebrae_S1", "vertebrae_L5", "vertebrae_L4", "vertebrae_L3"]
    pelvis = np.zeros(shape, bool)
    for p in pelvis_parts:
        pelvis |= seg(p) > 0
    fem_r, fem_l = fem_r > 0, fem_l > 0
    # sanity: right femur must be at lower x (patient right is -x)
    assert np.argwhere(fem_r)[:, 0].mean() < np.argwhere(fem_l)[:, 0].mean()

    idx2mm = lambda ijk: np.asarray(ijk, float) * SP  # voxel index -> mm (before origin shift)

    # ---------- femoral heads ----------
    def head(fem):
        ks = np.where(fem.any((0, 1)))[0]
        top = ks.min()
        sub = fem.copy()
        sub[:, :, top + int(90 / SP):] = False
        dt = ndi.distance_transform_edt(sub)
        c0 = np.array(np.unravel_index(np.argmax(dt), dt.shape), float)
        r0 = dt.max()
        surf = sub & ~ndi.binary_erosion(sub)
        pts = np.argwhere(surf).astype(float)
        d = pts - c0
        dist = np.linalg.norm(d, axis=1)
        side = np.sign(c0[0] - shape[0] / 2)  # +1 left femur, -1 right femur
        lateral = np.array([side, 0, 0])
        neckdir = unit(lateral + np.array([0, 0, 1]))
        keep = (dist < 1.5 * r0) & ((d @ neckdir) < 0.25 * r0)
        c, r = sphere_fit(pts[keep])
        return idx2mm(c), r * SP

    hc_r, hr_r = head(fem_r)
    hc_l, hr_l = head(fem_l)
    origin_shift = (hc_r + hc_l) / 2  # mm in raw index frame
    O = -origin_shift  # add to raw mm to get patient-frame mm
    hc_r, hc_l = hc_r + O, hc_l + O
    print("heads", hc_r.round(1), hr_r.round(1), hc_l.round(1), hr_l.round(1))
    vox_origin = O  # patient-frame mm of voxel (0,0,0) centre

    def coords(mask):
        return np.argwhere(mask) * SP + vox_origin

    # ---------- shaft and neck axes (operated = right femur) ----------
    pr = coords(fem_r)
    dia = pr[(pr[:, 2] > hc_r[2] + 120) & (pr[:, 2] < hc_r[2] + 280)]
    cen = dia.mean(0)
    _, _, vt = np.linalg.svd(dia - cen, full_matrices=False)
    shaft = vt[0] if vt[0][2] > 0 else -vt[0]
    # neck axis: from head centre towards the trochanteric region
    lateral = np.array([-1.0, 0, 0])
    d = unit(lateral + np.array([0, 0, 1.0]))
    for _ in range(6):
        cs = []
        for s in np.arange(hr_r * 0.95, hr_r * 1.6, 2.0):
            proj = (pr - hc_r) @ d
            sl = pr[(proj > s) & (proj < s + 2.5)]
            # only the connected neck part near the axis
            rad = np.linalg.norm((sl - hc_r) - np.outer((sl - hc_r) @ d, d), axis=1)
            sl = sl[rad < 22]
            if len(sl) > 20:
                cs.append(sl.mean(0))
        cs = np.array(cs)
        d = unit(((cs - hc_r) / np.linalg.norm(cs - hc_r, axis=1)[:, None]).mean(0))
    neck_lat = d  # unit, head centre -> lateral (towards GT)
    nsa = np.degrees(np.arccos(np.clip(np.dot(-neck_lat, shaft), -1, 1)))
    # anteversion relative to the coronal plane (approx., no condylar axis)
    antev = np.degrees(np.arcsin(-neck_lat[1]))
    print("neck-shaft angle %.1f, neck anteversion vs coronal %.1f" % (nsa, antev))
    gt_cand = pr[pr[:, 0] < hc_r[0] - 35]
    gt_tip = gt_cand[np.argmin(gt_cand[:, 2])]
    knee_r = pr[pr[:, 2] > pr[:, 2].max() - 25].mean(0)
    pl_ = coords(fem_l)
    knee_l = pl_[pl_[:, 2] > pl_[:, 2].max() - 25].mean(0)
    dia_l = pl_[(pl_[:, 2] > hc_l[2] + 120) & (pl_[:, 2] < hc_l[2] + 280)]
    _, _, vt = np.linalg.svd(dia_l - dia_l.mean(0), full_matrices=False)
    shaft_l = vt[0] if vt[0][2] > 0 else -vt[0]

    # ---------- body (skin) ----------
    body = ct > -500
    body = ndi.binary_opening(body, ball(2))
    body = largest_cc(body)
    body = fill_holes_axial(body)
    body = ndi.binary_closing(body, ball(1))
    # lateral truncation: extend each axial slice with a rounded cap
    PAD = 20
    ext = np.zeros((shape[0] + 2 * PAD, shape[1], shape[2]), bool)
    ext[PAD:-PAD] = body
    nfill = 0
    for k in range(shape[2]):
        for edge, sgn in ((0, -1), (shape[0] - 1, 1)):
            rows = np.where(body[edge, :, k])[0]
            if len(rows) < 3:
                continue
            nfill += 1
            y0, y1 = rows.min(), rows.max()
            yc, h = (y0 + y1) / 2, (y1 - y0 + 1) / 2
            W = min(PAD - 1, max(3, 0.35 * h))
            for dx in range(1, PAD):
                if dx >= W:
                    break
                hh = h * np.sqrt(1 - (dx / W) ** 2)
                ya, yb = int(np.ceil(yc - hh)), int(np.floor(yc + hh))
                xi = PAD + edge + sgn * dx
                ext[xi, max(ya, 0):yb + 1, k] = True
    print("slices with lateral cap", nfill)
    ext = ndi.binary_closing(ext, ball(2))
    ext_origin = vox_origin - np.array([PAD * SP, 0, 0])
    added = ext.copy()
    added[PAD:-PAD] &= ~body  # voxels that were outside the field of view

    # posterior skin (table contact) near the pelvis
    zr = (np.arange(shape[2]) * SP + vox_origin[2])
    zsel = (zr > -150) & (zr < 60)
    ys = np.where(body[:, :, zsel].any((0, 2)))[0]
    table_y = ys.min() * SP + vox_origin[1]

    # well leg (patient left) = body below an oblique plane through the left upper thigh
    P0 = hc_l + 75 * shaft_l
    gx, gy, gz = np.meshgrid(np.arange(ext.shape[0]) * SP + ext_origin[0],
                             np.arange(shape[1]) * SP + ext_origin[1],
                             np.arange(shape[2]) * SP + ext_origin[2], indexing="ij", sparse=True)
    below = ((gx - P0[0]) * shaft_l[0] + (gy - P0[1]) * shaft_l[1] + (gz - P0[2]) * shaft_l[2]) > 0
    well = ext & below & (gx > 0)
    # make sure the leg is one piece (drop scraps)
    well = largest_cc(well)
    main_skin = ext & ~well
    main_skin = largest_cc(main_skin)

    # ---------- lower-leg bones (not in the masks): threshold + clean ----------
    allmask = pelvis | fem_r | fem_l
    zknee = min(knee_r[2], knee_l[2]) - 80
    kk = int((zknee - vox_origin[2]) / SP)
    leg = np.zeros(shape, bool)
    sub = ct[:, :, kk:] > 220
    sub = fill_holes_axial(sub)
    sub = ndi.binary_opening(sub, ball(2))
    sub &= ~ndi.binary_dilation(allmask[:, :, kk:], ball(1))
    lab, n = ndi.label(sub)
    sizes = ndi.sum(sub, lab, range(1, n + 1))
    keep_ids = 1 + np.where(sizes * SP ** 3 > 1500)[0]
    leg[:, :, kk:] = np.isin(lab, keep_ids)
    xmid = int(round(-vox_origin[0] / SP))
    leg_r = leg.copy(); leg_r[xmid:] = False
    leg_l = leg.copy(); leg_l[:xmid] = False
    print("leg bone voxels", leg_r.sum(), leg_l.sum())

    # ---------- meshes ----------
    meshes = {}
    meshes["pelvis"] = mesh_from_mask(pelvis, vox_origin, 70000)
    meshes["femur_op"] = mesh_from_mask(fem_r, vox_origin, 40000)
    meshes["femur_contra"] = mesh_from_mask(fem_l, vox_origin, 22000)
    meshes["legbones_op"] = mesh_from_mask(leg_r, vox_origin, 30000, sigma=0.9)
    meshes["legbones_contra"] = mesh_from_mask(leg_l, vox_origin, 16000, sigma=0.9)
    meshes["skin"] = mesh_from_mask(main_skin, ext_origin, 70000, sigma=1.6, step=2)
    meshes["well_leg"] = mesh_from_mask(well, ext_origin, 22000, sigma=1.6, step=2)
    scene = trimesh.Scene()
    for name, m in meshes.items():
        print(name, len(m.faces), "tris")
        m.visual = trimesh.visual.ColorVisuals(m)
        scene.add_geometry(m, node_name=name, geom_name=name)
    scene.export(f"{tmp}/anatomy_raw.glb")

    # ---------- DRR volume around the operated (right) hip ----------
    bone_zone = ndi.binary_dilation(allmask, ball(1))
    hu = ct.astype(np.float32)
    hu[(~bone_zone) & (hu > 120)] = 40.0  # remove vessel / bladder contrast and calcifications
    hu[~body] = -1000.0  # air, no CT table
    # pad like the skin and fill the cut-off lateral tissue with fat
    hu_e = np.full(ext.shape, -1000.0, np.float32)
    hu_e[PAD:-PAD] = hu
    hu_e[added] = -80.0
    hu_e[well] = -1000.0  # well leg is lifted out of the beam
    lab_e = np.zeros(ext.shape, np.uint8)
    lab_e[PAD:-PAD][pelvis] = 1
    lab_e[PAD:-PAD][fem_l] = 3
    fz = ndi.binary_dilation(fem_r, ball(1)) & ~pelvis  # 1-voxel margin, never into the acetabulum
    lab_e[PAD:-PAD][fz] = 2

    lo = hc_r + np.array([-200.0, 0, -175])
    hi = hc_r + np.array([140.0, 0, 245])
    i0 = max(0, int((lo[0] - ext_origin[0]) / SP)); i1 = min(ext.shape[0], int((hi[0] - ext_origin[0]) / SP) + 1)
    k0 = max(0, int((lo[2] - ext_origin[2]) / SP)); k1 = min(shape[2], int((hi[2] - ext_origin[2]) / SP) + 1)
    region = ext[i0:i1, :, k0:k1]
    js = np.where(region.any((0, 2)))[0]
    j0, j1 = max(0, js.min() - 3), min(shape[1], js.max() + 4)
    crop = (slice(i0, i1), slice(j0, j1), slice(k0, k1))
    H = hu_e[crop]; L = lab_e[crop]
    femz = L == 2
    excess = np.where(femz, np.maximum(H - 30.0, 0), 0)
    base = np.where(femz, 30.0, H)
    # light smoothing of soft tissue only (less noise, better compression)
    bz = ndi.binary_dilation(L > 0, ball(1))
    sm = ndi.gaussian_filter(base, 0.8)
    base = np.where(bz, base, sm)
    STEP = 2  # resample to 3 mm? no: keep 1.5 mm unless too big
    vol_sp = SP
    q = lambda a: np.clip(np.round(a), 0, 255).astype(np.uint8)
    qb = q((base + 1000) / 12.0)
    qe = q(excess / 12.0)
    print("volume dims", qb.shape, "voxels", qb.size)
    # x-fastest planar layout: transpose to (k, j, i) C-order
    planes = [np.ascontiguousarray(a.transpose(2, 1, 0)) for a in (qb, qe, L)]
    # byte-delta filter along x for the first two channels (decoded in JS)
    def delta(a):
        d = a.astype(np.int16)
        d[..., 1:] = d[..., 1:] - d[..., :-1]
        return (d & 255).astype(np.uint8)
    blob = delta(planes[0]).tobytes() + delta(planes[1]).tobytes() + planes[2].tobytes()
    with gzip.open(f"{out}/volume.bin.gz", "wb", compresslevel=9) as fh:
        fh.write(blob)
    vol_corner = np.array([crop[0].start * SP + ext_origin[0], crop[1].start * SP + ext_origin[1],
                           crop[2].start * SP + ext_origin[2]]) - SP / 2
    print("volume.bin.gz", os.path.getsize(f"{out}/volume.bin.gz") // 1024, "KB")

    # crotch (perineum): about 2.5 cm below the lower border of the pubic symphysis
    pp = coords(pelvis)
    sym = pp[np.abs(pp[:, 0]) < 25]
    crotch_z = sym[:, 2].max() + 25
    print("crotch z", crotch_z)

    zs = np.where(body.any((0, 1)))[0]
    top_k = zs.min()
    top_sl = body[:, :, top_k:top_k + 10].any(2)
    tx = np.where(top_sl.any(1))[0]; ty = np.where(top_sl.any(0))[0]
    r3 = lambda v: [round(float(x), 2) for x in v]
    meta = {
        "case": "s0774",
        "dataset": "TotalSegmentator dataset v2.0.1 (doi:10.5281/zenodo.10047292)",
        "licence": "CC BY 4.0",
        "patient": "female, 75 years, CT angiography pelvis-leg (contrast removed for DRR)",
        "frame": "mm; +x patient left, +y anterior, +z inferior; origin midway between femoral head centres",
        "operatedSide": "right",
        "landmarks": {
            "headCenter": r3(hc_r), "headRadius": round(float(hr_r), 2),
            "headCenterContra": r3(hc_l), "headRadiusContra": round(float(hr_l), 2),
            "neckAxisLateral": r3(neck_lat), "shaftAxis": r3(shaft), "shaftAxisContra": r3(shaft_l),
            "neckShaftAngle": round(float(nsa), 1), "gtTip": r3(gt_tip),
            "kneeCenter": r3(knee_r), "kneeCenterContra": r3(knee_l),
            "wellLegCutPoint": r3(P0),
        },
        "body": {
            "tableY": round(float(table_y), 1),
            "crotchZ": round(float(crotch_z), 1),
            "zTop": round(float(zs.min() * SP + vox_origin[2]), 1),
            "zBottom": round(float(zs.max() * SP + vox_origin[2]), 1),
            "topSection": {"xMin": round(float(tx.min() * SP + vox_origin[0]), 1),
                           "xMax": round(float(tx.max() * SP + vox_origin[0]), 1),
                           "yMin": round(float(ty.min() * SP + vox_origin[1]), 1),
                           "yMax": round(float(ty.max() * SP + vox_origin[1]), 1)},
        },
        "volume": {
            "file": "volume.bin.gz", "dims": [int(s) for s in qb.shape], "spacing": vol_sp,
            "corner": r3(vol_corner), "layout": "planar uint8 x-fastest: base(delta), excess(delta), label",
            "huScale": 12, "huOffset": -1000, "softHU": 30,
            "labels": {"pelvis": 1, "femurOp": 2, "femurContra": 3},
        },
        "meshes": {"file": "anatomy.glb", "names": list(meshes.keys())},
    }
    json.dump(meta, open(f"{out}/meta.json", "w"), indent=1)
    print(json.dumps(meta["landmarks"], indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:4])
