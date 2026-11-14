"""Build the lateral-viewer assets (bone meshes, 3-level DRR volume, landmarks) from one CT.

Adapted from ../../tools/build_assets.py (the VR trainer's builder, which is left unchanged).

CT: autoPET / FDG-PET-CT-Lesions, PETCT_d3dac0d1cd (woman, 75 y), 1 mm slices every 0.7 mm, CC BY 4.0,
Gatidis S et al. Sci Data 2022;9:601, doi:10.1038/s41597-022-01718-3. Bone masks: TotalSegmentator
(Wasserthal J et al. Radiol Artif Intell 2023;5:e230024). Get both with fetch_ct.py.

Usage:  python build_assets.py <work_dir> <out_dir>
  work_dir contains ct.nii.gz (full resolution) and seg/*.nii.gz (TotalSegmentator, any resolution)
Then:   gltfpack -i <out_dir>/bones_raw.glb -o <out_dir>/bones.glb -cc -kn -km   (npm i gltfpack)

Patient frame (mm): +x patient LEFT, +y ANTERIOR, +z INFERIOR, origin midway between the femoral head centres.
The operated hip is the patient's RIGHT (x < 0). Everything is written in the traction-table position:
  operated leg: hip extended (mechanical axis horizontal), patella up, then 15 deg internal rotation;
  well leg: lifted out of the lateral beam (hemilithotomy): its thigh is removed beyond a rounded stump.
The operated leg is turned about its femoral head centre; bone moves rigidly, soft tissue follows the nearest
bone smoothly (warp.py), so the pelvis never moves and there are no cut lines.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anatomy  # noqa: E402
import fracture as fx  # noqa: E402
import warp  # noqa: E402

OUT_SP = 0.8        # output working grid (mm) = fine level
LEVELS = {'fine': 0.8, 'mid': 1.6, 'coarse': 3.2}
IR_DEG = 15.0       # internal rotation of the operated leg (neck about level with the floor)
SOFT_HU = 30.0      # value left in place of bone in the base channel
EXC_SCALE = 8.0     # HU per unit of the bone-excess channel (0..2040 HU above SOFT_HU)
BASE_SCALE, BASE_OFF = 12.0, -1000.0
SID, SOD, DET_R = 1000.0, 620.0, 150.0  # C-arm geometry (as js/carm.js)


def load_lai(path, dtype=np.int16):
    """NIfTI -> array with axes (Left, Anterior, Inferior), spacing (mm) and the LAI mm position of voxel 0."""
    im = nib.as_closest_canonical(nib.load(path))
    A = im.affine
    a = np.asanyarray(im.dataobj)[::-1, :, ::-1]
    sp = np.abs(np.diag(A)[:3])
    n = a.shape
    org = np.array([-(A[0, 3] + (n[0] - 1) * A[0, 0]), A[1, 3], -(A[2, 3] + (n[2] - 1) * A[2, 2])])
    return np.ascontiguousarray(a.astype(dtype)), sp, org


def sample(arr, sp, org, pts, order=1, cval=0.0):
    """Sample an array (spacing sp, origin org) at points (..., 3) in mm."""
    return ndi.map_coordinates(arr, [(pts[..., i] - org[i]) / sp[i] for i in range(3)], order=order, cval=cval)


def grid_points(shape, sp, org, k0, k1):
    I = np.indices((shape[0], shape[1], k1 - k0), dtype=np.float32)
    return np.stack([I[0] * sp[0] + org[0], I[1] * sp[1] + org[1], (I[2] + k0) * sp[2] + org[2]], -1)


def resample_mask(m, msp, morg, shape, sp, org, thr=0.5, chunk=48):
    """Resample a binary mask onto another grid (trilinear, thresholded)."""
    out = np.zeros(shape, bool)
    mf = m.astype(np.float32)
    for k0 in range(0, shape[2], chunk):
        k1 = min(shape[2], k0 + chunk)
        P = grid_points(shape, sp, org, k0, k1)
        out[:, :, k0:k1] = sample(mf, msp, morg, P) > thr
    return out


def ball(r):
    g = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (g ** 2).sum(0) <= r * r


def mesh_from_mask(mask, sp, origin, target_tris, sigma=0.8, xform=None):
    f = np.pad(ndi.gaussian_filter(mask.astype(np.float32), sigma), 2)
    v, fc, _, _ = measure.marching_cubes(f, 0.5, spacing=tuple(sp))
    v = v - 2 * np.asarray(sp) + origin
    fc = fc[:, ::-1]
    if len(fc) > target_tris:
        v, fc = fast_simplification.simplify(v.astype(np.float32), fc.astype(np.int32),
                                             target_reduction=1 - target_tris / len(fc))
    m = trimesh.Trimesh(v, fc, process=True)
    trimesh.smoothing.filter_taubin(m, iterations=6)
    if xform is not None:
        m.vertices = xform(np.asarray(m.vertices))
    return m


def refine(mask_up, hu, exclude=None, thr=200):
    """Sharpen a smooth (upsampled) bone mask with the CT itself: keep the core, add dense voxels near the edge."""
    core = ndi.binary_erosion(mask_up, iterations=1)
    edge = ndi.binary_dilation(mask_up, iterations=2) & (hu > thr)
    if exclude is not None:
        edge &= ~exclude
    m = core | edge
    for k in range(m.shape[2]):
        m[:, :, k] = ndi.binary_fill_holes(m[:, :, k])
    m = ndi.binary_closing(m, ball(1))
    return anatomy.largest_cc(m)


def bbox(mask, sp, org, pad):
    idx = np.argwhere(mask)
    lo = idx.min(0) * sp + org - pad
    hi = idx.max(0) * sp + org + pad
    return lo, hi


def main(work, out):
    os.makedirs(out, exist_ok=True)
    # ---------------- load ----------------
    ct, sp, org = load_lai(f'{work}/ct.nii.gz')
    seg = lambda n: load_lai(f'{work}/seg/{n}.nii.gz', np.uint8)
    fem_r, msp, morg = seg('femur_right')
    fem_r = fem_r > 0
    fem_l = seg('femur_left')[0] > 0
    pel = np.zeros_like(fem_r)
    for n in ['hip_right', 'hip_left', 'sacrum', 'vertebrae_S1', 'vertebrae_L5', 'vertebrae_L4']:
        pel |= seg(n)[0] > 0
    print('CT', ct.shape, sp, '; masks', fem_r.shape, msp)
    # landmarks (world LAI), then move the origin to the midpoint of the head centres
    Lr = anatomy.femur(fem_r, msp[0], -1, morg)
    Ll = anatomy.femur(fem_l, msp[0], +1, morg)
    O = (Lr['headCenter'] + Ll['headCenter']) / 2
    org, morg = org - O, morg - O
    for L in (Lr, Ll):
        for k in ('headCenter', 'shaftPoint', 'knee', 'pclA', 'pclB'):
            L[k] = L[k] - O
    hc_r, hc_l = Lr['headCenter'], Ll['headCenter']
    print('right: NSA %.1f AV %.1f (anat %.1f); left: NSA %.1f AV %.1f' % (
        Lr['nsa'], Lr['anteversion'], Lr['anteversionAnat'], Ll['nsa'], Ll['anteversion']))
    assert hc_r[0] < 0 < hc_l[0]

    # ---------------- crop the source CT ----------------
    k0 = max(0, int((hc_r[2] - 330 - org[2]) / sp[2]))
    k1 = min(ct.shape[2], int((hc_r[2] + 480 - org[2]) / sp[2]))
    ct = ct[:, :, k0:k1]
    org = org + np.array([0, 0, k0 * sp[2]])
    print('source crop', ct.shape)

    # ---------------- contrast and table removal (source space; cached in work_dir) ----------------
    cache = f'{work}/source_clean.npy'
    if os.path.exists(cache):
        ct = np.load(cache)
    else:
        allbone = ndi.binary_dilation(pel | fem_r | fem_l, iterations=2).astype(np.uint8)
        for kk in range(0, ct.shape[2], 48):
            P = grid_points(ct.shape, sp, org, kk, min(ct.shape[2], kk + 48))
            bz = sample(allbone, msp, morg, P, order=0) > 0
            sl = ct[:, :, kk:kk + 48]
            sl[(~bz) & (sl > 120)] = 40  # vessels (portal-venous contrast) -> soft tissue
        # body = largest connected part above -500 HU, found on a coarse grid (drops the PET-CT table)
        st = (3, 3, 4)
        small = ct[::st[0], ::st[1], ::st[2]] > -500
        small = ndi.binary_opening(small, iterations=1)
        small = ndi.binary_dilation(anatomy.largest_cc(small), iterations=2)
        for kk in range(ct.shape[2]):
            keep = np.repeat(np.repeat(small[:, :, kk // st[2]], st[0], 0), st[1], 1)[:ct.shape[0], :ct.shape[1]]
            body = ndi.binary_fill_holes((ct[:, :, kk] > -500) & keep)
            ct[:, :, kk][~body] = -1000
        np.save(cache, ct)
    print('contrast and table removed')
    if os.environ.get('WARP_TEST'):  # quick check of the leg positioning only
        return dict(ct=ct, sp=sp, org=org, fem_r=fem_r, fem_l=fem_l, pel=pel, msp=msp, morg=morg, Lr=Lr, Ll=Ll)

    # ---------------- leg rotations ----------------
    R_op = warp.traction_rotation(hc_r, Lr['knee'], Lr['pclA'], Lr['pclB'], -1, IR_DEG)
    to_out = lambda p: (p - hc_r) @ R_op.T + hc_r     # operated femur: source -> traction position
    w_op = warp.weight_field(ct.shape, sp, org, fem_r, pel | fem_l, msp[0], morg, hc_r,
                             warp.unit(Lr['knee'] - hc_r), -1, 0.0)
    W_op = warp.LegWarp(R_op, hc_r, *w_op)
    # well leg lifted out of the beam: its thigh is removed beyond a rounded stump below the left hip
    rem, rem_sp, rem_org = warp.lifted_leg(ct.shape, sp, org, fem_l, fem_r, msp[0], morg, hc_l,
                                           warp.unit(Ll['knee'] - hc_l))
    removed = lambda pts: sample(rem, np.full(3, rem_sp), rem_org, pts)
    print('operated leg turned %.1f deg' % np.degrees(warp.axis_angle(R_op)[1]))

    # ---------------- operated femur at full resolution, fracture ----------------
    flo, fhi = bbox(fem_r, msp, morg, 8)
    fi0 = np.maximum(0, np.floor((flo - org) / sp).astype(int))
    fi1 = np.minimum(ct.shape, np.ceil((fhi - org) / sp).astype(int))
    fsl = tuple(slice(a, b) for a, b in zip(fi0, fi1))
    forg = org + fi0 * sp
    hu_f = ct[fsl]
    up = lambda m, s=hu_f.shape, o=forg: resample_mask(m, msp, morg, s, sp, o)
    fem_up = up(fem_r)
    pel_up = up(pel | fem_l)
    femF = refine(fem_up, hu_f, exclude=pel_up)
    print('operated femur voxels', femF.sum())
    I = np.argwhere(femF)
    pf_src = I * sp + forg
    pf = to_out(pf_src)
    dia = pf[(pf[:, 2] > hc_r[2] + 120) & (pf[:, 2] < hc_r[2] + 280)]
    cen = dia.mean(0)
    shaft = warp.unit(np.linalg.svd(dia - cen, full_matrices=False)[2][0])
    shaft = shaft if shaft[2] > 0 else -shaft
    FL = fx.femur_landmarks(pf, hc_r, (cen, shaft))
    ffun, fnorm, fp0 = fx.fracture_field(FL['fxLat'], FL['fxMed'], amp=1.6)
    for k in ('gtTip', 'gtLatFacet', 'gtAntFacet', 'trochFossa'):
        assert ffun(FL[k][None])[0] > 0, k + ' must be on the proximal fragment'
    assert ffun(FL['lt'][None])[0] < 0, 'lesser trochanter must stay with the distal fragment'
    side = ffun(pf) > 0
    proxF = np.zeros_like(femF)
    proxF[tuple(I[side].T)] = True
    distF = femF & ~proxF
    print('fragments: proximal %d, distal %d voxels' % (proxF.sum(), distF.sum()))
    # moving zones for the X-ray: femur + 2 voxels, never into the pelvis
    fz = (ndi.binary_dilation(femF, iterations=2) & ~(pel_up & ~femF)) | femF
    Iz = np.argwhere(fz)
    zprox = np.zeros_like(fz)
    zprox[tuple(Iz[ffun(to_out(Iz * sp + forg)) > 0].T)] = True
    zdist = fz & ~zprox

    # ---------------- output grid (traction position) ----------------
    x0, x1 = org[0], org[0] + ct.shape[0] * sp[0]
    lo = np.array([x0, hc_r[1] - 140, hc_r[2] - 300])
    hi = np.array([x1, hc_r[1] + 170, hc_r[2] + 360])
    oshape = tuple(np.ceil((hi - lo) / OUT_SP).astype(int))
    print('output grid', oshape)
    HU = np.empty(oshape, np.int16)
    LAB = np.zeros(oshape, np.uint8)
    ZONE = np.zeros(oshape, bool)
    statz = ndi.binary_dilation(pel | fem_l, iterations=1).astype(np.float32)
    zp, zd = zprox.astype(np.float32), zdist.astype(np.float32)
    osp = np.full(3, OUT_SP)
    for kk in range(0, oshape[2], 16):
        k2 = min(oshape[2], kk + 16)
        P = grid_points(oshape, osp, lo, kk, k2).astype(np.float64)
        Q = W_op(P)
        h = sample(ct, sp, org, Q, order=1, cval=-1000).astype(np.float32)
        r = removed(Q)
        HU[:, :, kk:k2] = np.round(h * (1 - r) - 1000 * r)
        wp = sample(zp, sp, forg, Q)
        wd = sample(zd, sp, forg, Q)
        ws = sample(statz, msp, morg, Q)
        z = wp + wd
        LAB[:, :, kk:k2] = np.where(z >= 0.5, np.where(wd > wp, 255, 128), 0)
        ZONE[:, :, kk:k2] = (z >= 0.5) | (ws >= 0.5)
        if kk % 160 == 0:
            print('  warp', kk, '/', oshape[2], flush=True)
    # keep only the body (drops small skin islands left by the lifted leg)
    small = ndi.binary_dilation(anatomy.largest_cc(HU[::4, ::4, ::4] > -500), iterations=2)
    for kk in range(oshape[2]):
        keep = np.repeat(np.repeat(small[:, :, kk // 4], 4, 0), 4, 1)[:oshape[0], :oshape[1]]
        HU[:, :, kk][~keep] = -1000
    EXC = np.where(ZONE, np.clip(HU.astype(np.float32) - SOFT_HU, 0, None), 0).astype(np.float32)
    BASE = np.where(ZONE, SOFT_HU, HU).astype(np.float32)
    del HU

    # ---------------- landmarks in the traction frame ----------------
    neck = R_op @ Lr['neck']
    knee = to_out(Lr['knee'])
    iso = hc_r + neck * (Lr['headRadius'] + 12)
    nh = neck.copy()
    nh[1] = 0
    nh = warp.unit(nh)
    dlat = np.array([nh[2], 0, -nh[0]])
    if dlat[0] > 0:
        dlat = -dlat  # superolateral (right hip: lateral = -x)
    pp = pf[side]
    pd = pf[~side]
    band_p = pp[np.abs(ffun(pp)) < 6]
    band_d = pd[np.abs(ffun(pd)) < 6]
    ant = warp.unit(np.array([0, 1.0, 0]) - shaft[1] * shaft)
    ant_prox = band_p[np.argmax(band_p @ ant)]
    ant_dist = band_d[np.argmax(band_d @ ant)]
    post_dist = band_d[np.argmin(band_d @ ant)]
    canal = fp0 + ((pd[np.abs((pd - fp0) @ shaft) < 3].mean(0) - fp0))  # shaft centre at the fracture level

    # ---------------- three volume levels ----------------
    # fine: proximal femur + acetabulum; mid: every bone the two beams can see; coarse: the rest (soft tissue)
    def box_idx(blo, bhi, s):
        a = np.maximum(0, np.floor((blo - lo) / OUT_SP).astype(int))
        b = np.minimum(oshape, np.ceil((bhi - lo) / OUT_SP).astype(int))
        f = int(round(s / OUT_SP))
        b = a + ((b - a) // f) * f
        return a, b, f

    fine_lo = np.array([hc_r[0] - 105, hc_r[1] - 75, hc_r[2] - 70])
    fine_hi = np.array([hc_r[0] + 85, hc_r[1] + 85, hc_r[2] + 175])
    mid_lo = np.array([lo[0] + 10, hc_r[1] - 125, hc_r[2] - 170])
    mid_hi = np.array([hc_l[0] + 60, hc_r[1] + 140, hc_r[2] + 300])
    vols = {}
    for name, blo, bhi in (('fine', fine_lo, fine_hi), ('mid', mid_lo, mid_hi)):
        a, b, f = box_idx(blo, bhi, LEVELS[name])
        sl = tuple(slice(a[i], b[i]) for i in range(3))
        e = EXC[sl]
        l = LAB[sl]
        if f > 1:
            n = tuple((b - a) // f)
            e = e.reshape(n[0], f, n[1], f, n[2], f).mean((1, 3, 5))
            lr = l.reshape(n[0], f, n[1], f, n[2], f)
            cd = (lr == 255).sum((1, 3, 5))
            cp = (lr == 128).sum((1, 3, 5))
            l = np.where((cd > 0) & (cd >= cp), 255, np.where(cp > 0, 128, 0)).astype(np.uint8)
        q = np.clip(np.round(e / EXC_SCALE), 0, 255).astype(np.uint8)
        vols[name] = dict(exc=q, lab=l, lo=(lo + a * OUT_SP - OUT_SP / 2 + f * OUT_SP / 2).tolist(), sp=f * OUT_SP)
        print(name, q.shape, 'nonzero %.1f%%' % (100 * (q > 0).mean()))
    # mid level is not used inside the fine box: zero it there (smaller file)
    fm = vols['mid']
    fbox_lo = np.array(vols['fine']['lo']) - vols['fine']['sp'] / 2
    fbox_hi = fbox_lo + np.array(vols['fine']['exc'].shape) * vols['fine']['sp']
    c = np.array(fm['lo']) + np.indices(fm['exc'].shape).transpose(1, 2, 3, 0) * fm['sp']
    inside = np.all((c > fbox_lo + 6) & (c < fbox_hi - 6), axis=-1)
    fm['exc'][inside] = 0
    fm['lab'][inside] = 0
    # coarse: soft tissue everywhere + bone outside the mid box (static)
    a, b, f = box_idx(lo, hi, LEVELS['coarse'])
    n = tuple((b - a) // f)
    sl = tuple(slice(a[i], b[i]) for i in range(3))
    mid_a, mid_b, _ = box_idx(mid_lo, mid_hi, LEVELS['mid'])
    outside_mid = np.ones(oshape, bool)
    outside_mid[mid_a[0]:mid_b[0], mid_a[1]:mid_b[1], mid_a[2]:mid_b[2]] = False
    base = BASE + np.where(outside_mid, EXC, 0)
    del outside_mid
    base = base[sl].reshape(n[0], f, n[1], f, n[2], f).mean((1, 3, 5))
    vols['coarse'] = dict(base=np.clip(np.round((base - BASE_OFF) / BASE_SCALE), 0, 255).astype(np.uint8),
                          lo=(lo + a * OUT_SP - OUT_SP / 2 + f * OUT_SP / 2).tolist(), sp=f * OUT_SP)
    print('coarse', vols['coarse']['base'].shape)

    files = {}
    for name, v in vols.items():
        planes = [v['base']] if name == 'coarse' else [v['exc'], v['lab']]
        blob = b''
        for i, p in enumerate(planes):
            t = np.ascontiguousarray(p.transpose(2, 1, 0))  # (z, y, x) C-order = x fastest
            if i == 0:
                dd = t.astype(np.int16)
                dd[..., 1:] = dd[..., 1:] - dd[..., :-1]
                t = (dd & 255).astype(np.uint8)
            blob += t.tobytes()
        fn = f'vol_{name}.bin.gz'
        with gzip.open(f'{out}/{fn}', 'wb', compresslevel=9) as fh:
            fh.write(blob)
        files[name] = fn
        print(fn, os.path.getsize(f'{out}/{fn}') // 1024, 'KB')

    # ---------------- meshes ----------------
    meshes = {}
    meshes['femur_prox'] = mesh_from_mask(proxF, sp, forg, 30000, 0.8, to_out)
    meshes['femur_dist'] = mesh_from_mask(distF, sp, forg, 45000, 0.8, to_out)
    plo, phi = bbox(pel, msp, morg, 6)
    pshape = tuple(np.ceil((phi - plo) / 1.0).astype(int))
    pel1 = resample_mask(pel, msp, morg, pshape, np.ones(3), plo)
    # pelvis refined with the CT (source space; the pelvis is not moved)
    ct2, sp2, org2 = ct, sp, org
    hu_p = np.empty(pshape, np.float32)
    for kk in range(0, pshape[2], 48):
        P = grid_points(pshape, np.ones(3), plo, kk, min(pshape[2], kk + 48))
        hu_p[:, :, kk:kk + 48] = sample(ct2, sp2, org2, P, cval=-1000)
    fem1 = resample_mask(fem_r | fem_l, msp, morg, pshape, np.ones(3), plo)
    pelF = refine(pel1, hu_p, exclude=fem1)
    meshes['pelvis'] = mesh_from_mask(pelF, np.ones(3), plo, 80000, 0.7)
    llo, lhi = bbox(fem_l, msp, morg, 6)
    lhi[2] = min(lhi[2], hc_l[2] + 190)
    lshape = tuple(np.ceil((lhi - llo) / 1.0).astype(int))
    hu_l = np.empty(lshape, np.float32)
    for kk in range(0, lshape[2], 48):
        P = grid_points(lshape, np.ones(3), llo, kk, min(lshape[2], kk + 48))
        hu_l[:, :, kk:kk + 48] = sample(ct2, sp2, org2, P, cval=-1000)
    del ct, ct2
    femL = refine(resample_mask(fem_l, msp, morg, lshape, np.ones(3), llo), hu_l,
                  exclude=resample_mask(pel, msp, morg, lshape, np.ones(3), llo))
    Il = np.argwhere(femL)
    femL[tuple(Il[removed(Il * 1.0 + llo) > 0.5].T)] = False  # the lifted thigh is out of the volume
    meshes['femur_contra'] = mesh_from_mask(anatomy.largest_cc(femL), np.ones(3), llo, 12000, 0.8)
    scene = trimesh.Scene()
    for name, m in meshes.items():
        print(name, len(m.faces), 'tris')
        m.visual = trimesh.visual.ColorVisuals(m)
        scene.add_geometry(m, node_name=name, geom_name=name)
    scene.export(f'{out}/bones_raw.glb')

    # ---------------- meta ----------------
    r3 = lambda v: [round(float(x), 2) for x in v]
    meta = {
        'case': 'PETCT_d3dac0d1cd',
        'dataset': 'autoPET / FDG-PET-CT-Lesions (TCIA), via NCI Imaging Data Commons',
        'citation': 'Gatidis S et al. A whole-body FDG-PET/CT dataset with manually annotated tumor lesions. '
                    'Sci Data 2022;9:601. doi:10.1038/s41597-022-01718-3',
        'licence': 'CC BY 4.0',
        'patient': 'female, 75 years; CT 1 mm slices every 0.7 mm, 0.86 mm pixels, IV contrast (removed)',
        'frame': 'mm; +x patient left, +y anterior, +z inferior; origin midway between femoral head centres',
        'position': {'operated': 'right hip extended, patella up, %g deg internal rotation' % IR_DEG,
                     'well': 'left thigh lifted out of the beam (removed beyond a rounded stump below the left hip)',
                     'R_op': [r3(r) for r in R_op]},
        'measured': {'neckShaftAngle': round(Lr['nsa'], 1), 'anteversion': round(Lr['anteversion'], 1),
                     'anteversionShaftAxis': round(Lr['anteversionAnat'], 1),
                     'method': 'neck axis vs posterior condylar line, viewed along head centre -> knee centre'},
        'landmarks': {
            'headCenter': r3(hc_r), 'headRadius': round(Lr['headRadius'], 2), 'neckAxis': r3(neck),
            'shaftAxis': r3(shaft), 'shaftPoint': r3(cen), 'knee': r3(knee),
            'headCenterContra': r3(hc_l), 'lt': r3(FL['lt']), 'gtTip': r3(FL['gtTip']),
            'antProx': r3(ant_prox), 'antDist': r3(ant_dist), 'postDist': r3(post_dist), 'canal': r3(canal),
            'anterior': r3(ant),
        },
        'fracture': {
            'type': 'AO/OTA 31-A1 two-part pertrochanteric (lateral wall intact, lesser trochanter on the shaft)',
            'normal': r3(fnorm), 'point': r3(fp0), 'fxLat': r3(FL['fxLat']), 'fxMed': r3(FL['fxMed']),
        },
        'carm': {'SID': SID, 'SOD': SOD, 'detR': DET_R, 'iso': r3(iso), 'lateralDir': r3(dlat), 'apDir': [0, 1, 0]},
        'volume': {
            'softHU': SOFT_HU, 'excessScale': EXC_SCALE, 'baseScale': BASE_SCALE, 'baseOffset': BASE_OFF,
            'labels': 'lab: 0 static, 128 proximal (head-neck) fragment, 255 distal (shaft) fragment; linear in between',
            'layout': 'x-fastest uint8 planes; first plane byte-delta along x. fine/mid: excess, lab. coarse: base',
            'levels': {k: {'file': files[k], 'dims': [int(s) for s in (v['base'] if k == 'coarse' else v['exc']).shape],
                           'spacing': v['sp'], 'center0': r3(v['lo'])} for k, v in vols.items()},
        },
        'meshes': {'file': 'bones.glb', 'names': list(meshes.keys())},
    }
    json.dump(meta, open(f'{out}/meta.json', 'w'), indent=1)
    print(json.dumps(meta['landmarks'], indent=1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
