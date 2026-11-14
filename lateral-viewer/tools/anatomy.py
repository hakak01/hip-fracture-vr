"""Femoral landmarks from a femur mask: head centre, neck axis, shaft axis, knee centre, posterior condylar line,
neck-shaft angle and femoral version (anteversion).

Frame: millimetres, +x patient LEFT, +y ANTERIOR, +z INFERIOR (array axes i, j, k of the volumes used here).

Anteversion = angle between the femoral neck axis and the posterior condylar line, both projected onto the plane
perpendicular to the femoral mechanical axis (head centre -> knee centre); positive = head-neck points anterior.
Neck-shaft angle = 3D angle between the neck axis and the proximal shaft (anatomical) axis.
Femoral torsion values depend on the measurement technique: Kaiser P et al., Arch Orthop Trauma Surg
2016;136:1259-64, doi:10.1007/s00402-016-2536-3.
"""
import numpy as np
import scipy.ndimage as ndi


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def sphere_fit(p):
    A = np.c_[2 * p, np.ones(len(p))]
    b = (p ** 2).sum(1)
    c, *_ = np.linalg.lstsq(A, b, rcond=None)
    return c[:3], float(np.sqrt(c[3] + (c[:3] ** 2).sum()))


def largest_cc(m):
    lab, n = ndi.label(m)
    if n <= 1:
        return m
    sizes = ndi.sum(m, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def femur(fem, sp, side, origin=(0.0, 0.0, 0.0)):
    """fem: boolean femur mask (isotropic spacing sp, mm). side: -1 = patient right femur (lateral = -x), +1 = left.
    origin: mm position of voxel (0,0,0). Returns a dict of landmarks (mm, same frame)."""
    fem = ndi.binary_fill_holes(largest_cc(fem))
    org = np.asarray(origin, float)
    pts = np.argwhere(fem) * sp + org
    surf = np.argwhere(fem & ~ndi.binary_erosion(fem)) * sp + org
    lat = np.array([side, 0, 0.0])
    ztop, zbot = pts[:, 2].min(), pts[:, 2].max()
    length = zbot - ztop
    # head: deepest point of the medial part of the top 70 mm, then a sphere fit to its articular surface
    k70 = int((ztop + 70 - org[2]) / sp) + 1
    dt = ndi.distance_transform_edt(fem[:, :, :k70]) * sp
    tp = np.argwhere(fem[:, :, :k70])
    cx = tp[:, 0].mean()
    med = tp[(tp[:, 0] - cx) * (-side) > 0]
    best = med[np.argmax(dt[tuple(med.T)])]
    c0, r0 = best * sp + org, dt[tuple(best)]
    for _ in range(4):
        d = surf - c0
        dist = np.linalg.norm(d, axis=1)
        keep = (dist < 1.5 * r0) & (np.abs(dist - r0) < 7) & ((d @ unit(lat + np.array([0, 0, 1.0]))) < 0.25 * r0)
        c0, r0 = sphere_fit(surf[keep])
    hc, hr = c0, r0
    # proximal shaft axis: centroids of axial slices from 25 % to 55 % of the femur length
    cs = []
    for z in np.arange(hc[2] + 0.25 * length, hc[2] + 0.55 * length, 3):
        sl = pts[np.abs(pts[:, 2] - z) < 1.5]
        if len(sl) > 30:
            cs.append(sl.mean(0))
    cs = np.array(cs)
    shaft = unit(np.linalg.svd(cs - cs.mean(0), full_matrices=False)[2][0])
    shaft = shaft if shaft[2] > 0 else -shaft
    shaft_pt = cs.mean(0)
    # neck axis: head centre through the centroids around the narrowest neck section
    d = unit(lat + np.array([0, 0, 1.0]))
    for _ in range(8):
        cents, areas = [], []
        proj = (pts - hc) @ d
        for s in np.arange(0.6 * hr, 2.2 * hr, 1.5):
            sl = pts[np.abs(proj - s) < sp * 0.75]
            rad = np.linalg.norm((sl - hc) - np.outer((sl - hc) @ d, d), axis=1)
            sl = sl[rad < 1.3 * hr]
            if len(sl) > 10:
                cents.append(sl.mean(0))
                areas.append(len(sl))
        cents, areas = np.array(cents), np.array(areas)
        i = np.argmin(areas[: max(3, len(areas) * 2 // 3)])
        sel = cents[max(0, i - 4): i + 5]
        d = unit(((sel - hc) / np.linalg.norm(sel - hc, axis=1)[:, None]).mean(0))
    neck = d
    nsa = float(np.degrees(np.arccos(np.clip(-neck @ shaft, -1, 1))))
    # distal femur: knee centre and posterior condylar line
    dist = pts[pts[:, 2] > zbot - 45]
    knee = dist.mean(0)
    mech = unit(knee - hc)
    av, a, b = version(neck, mech, dist, knee, lat)
    av_anat, _, _ = version(neck, shaft, dist, knee, lat)
    return dict(headCenter=hc, headRadius=hr, neck=neck, shaft=shaft, shaftPoint=shaft_pt, knee=knee,
                pclA=a, pclB=b, nsa=nsa, anteversion=av, anteversionAnat=av_anat, length=float(length))


def version(neck, axis, dist, knee, lat):
    """Angle of the neck vs the posterior condylar line, viewed along `axis`. Returns (deg, pclA, pclB)."""
    e2 = unit(np.array([0, 1.0, 0]) - axis[1] * axis)
    e1 = np.cross(e2, axis)
    P2 = np.c_[(dist - knee) @ e1, (dist - knee) @ e2]
    post = np.array([0, -1.0])
    for _ in range(10):
        tang = np.array([post[1], -post[0]])
        u = P2 @ tang
        m1, m2 = P2[u < np.median(u)], P2[u >= np.median(u)]
        a, b = m1[np.argmax(m1 @ post)], m2[np.argmax(m2 @ post)]
        t = unit(b - a)
        n = np.array([-t[1], t[0]])
        post = n if n[1] < 0 else -n
    lat2 = unit(np.array([lat @ e1, lat @ e2]))
    pcl2 = unit(b - a)
    pcl2 = pcl2 if pcl2 @ lat2 > 0 else -pcl2
    neck2 = unit(np.array([neck @ e1, neck @ e2]))
    neck2 = neck2 if neck2 @ lat2 > 0 else -neck2
    R = np.array([[lat2[0], lat2[1]], [-lat2[1], lat2[0]]])
    n_, p_ = R @ neck2, R @ pcl2
    ant = R @ np.array([0, 1.0])
    sgn = np.sign(ant[1]) if abs(ant[1]) > 1e-6 else 1.0
    av = -np.degrees(np.arctan2(n_[1] * sgn, n_[0]) - np.arctan2(p_[1] * sgn, p_[0]))
    av = (av + 180) % 360 - 180
    to3 = lambda q: knee + q[0] * e1 + q[1] * e2
    return float(av), to3(a), to3(b)
