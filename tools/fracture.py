"""AO 31A1 two-part pertrochanteric fracture, fragment contact data and muscle attachment points.

All coordinates are in the patient frame (mm): +x patient left, +y anterior, +z inferior.
The operated femur is the patient's RIGHT femur, so lateral = -x and medial = +x.
"""
import numpy as np
import scipy.ndimage as ndi

LAT = np.array([-1.0, 0, 0])
MED = -LAT
ANT = np.array([0, 1.0, 0])
POST = -ANT
SUP = np.array([0, 0, -1.0])
INF = -SUP


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


class Shaft:
    """Femoral shaft line: s = distance along the (distal-pointing) shaft axis from the head centre level."""

    def __init__(self, point, axis, head):
        self.p, self.a = np.asarray(point, float), unit(axis)
        self.s0 = (np.asarray(head) - self.p) @ self.a

    def s(self, pts):
        return (pts - self.p) @ self.a - self.s0

    def radial(self, pts):
        d = pts - self.p
        return d - np.outer(d @ self.a, self.a)


def extreme(pts, direction, mask=None):
    """Point of pts furthest along a direction (optionally among a subset)."""
    q = pts if mask is None else pts[mask]
    if len(q) == 0:
        raise ValueError("empty landmark region")
    return q[np.argmax(q @ unit(direction))]


def nearest(pts, target):
    return pts[np.argmin(np.linalg.norm(pts - target, axis=1))]


def femur_landmarks(pf, hc, shaft):
    """pf: femur surface/voxel points of the operated femur."""
    S = Shaft(*shaft, hc)
    s = S.s(pf)
    rad = S.radial(pf)
    # lesser trochanter: most postero-medial protrusion 25-90 mm below the head centre
    band = (s > 25) & (s < 90)
    score = rad @ unit(MED + POST)
    i = np.argmax(np.where(band, score, -1e9))
    lt = pf[i]
    s_lt = s[i]
    # greater trochanter tip: most superior point lateral to the neck
    gtc = pf[pf[:, 0] < hc[0] - 35]
    gt_tip = gtc[np.argmin(gtc[:, 2])]
    s_gt = S.s(gt_tip[None])[0]
    lev = lambda a, b: (s > a) & (s < b)
    L = {
        "lt": lt,
        "gtTip": gt_tip,
        # fracture end points: lateral GT wall ~15 mm below the tip, medial cortex just above the LT
        "fxLat": extreme(pf, LAT, lev(s_gt + 7, s_gt + 10) & (pf[:, 0] < hc[0] - 30)),
        "fxMed": extreme(pf, MED, lev(s_lt - 17, s_lt - 14)),
        "gtLatFacet": extreme(pf, LAT, lev(s_gt + 1, s_gt + 4) & (pf[:, 0] < hc[0] - 30)),
        "gtAntFacet": extreme(pf, ANT, lev(s_gt + 3, s_gt + 10) & (pf[:, 0] < hc[0] - 35)),
        "trochFossa": nearest(pf, gt_tip + 12 * MED + 10 * POST + 8 * INF),
        "lineaAspera": extreme(pf, POST, lev(s_lt + 110, s_lt + 116)),
        "adductorTubercle": extreme(pf, MED, lev(s.max() - 52, s.max() - 46)),
        "sLT": float(s_lt), "sGT": float(s_gt),
    }
    return L


def pelvis_landmarks(ph, sac, hc):
    """ph: points of the right hip bone, sac: sacrum points."""
    x, y, z = ph[:, 0], ph[:, 1], ph[:, 2]
    L = {}
    L["asis"] = extreme(ph, ANT, z < hc[2] - 40)
    L["aiis"] = extreme(ph, ANT, (z > hc[2] - 45) & (z < hc[2] - 15) & (x < hc[0] + 10))
    L["iliumOuter"] = extreme(ph, LAT, (z > hc[2] - 100) & (z < hc[2] - 60) & (y < hc[1] + 5))
    L["iliumLower"] = extreme(ph, LAT, (z > hc[2] - 60) & (z < hc[2] - 35) & (y > hc[1] - 10))
    L["ischialTub"] = extreme(ph, INF, y < hc[1] - 10)
    L["ischialSpine"] = extreme(ph, MED, (y < hc[1] - 20) & (z > hc[2]) & (z < hc[2] + 25))
    L["pubicBody"] = extreme(ph, ANT + INF, x > hc[0] + 55)
    L["ischiopubic"] = extreme(ph, INF, (z > hc[2] + 30) & (x > hc[0] + 40))
    L["iliopectineal"] = nearest(ph, hc + 25 * MED + 20 * ANT + 8 * SUP)
    sx = sac[:, 0]
    L["sacrumAnt"] = extreme(sac, ANT, (sx < -10) & (sac[:, 2] > hc[2] - 75) & (sac[:, 2] < hc[2] - 30))
    return L


def leg_landmarks(pleg, pskin, knee):
    """pleg: operated lower-leg bone points (tibia/fibula/patella/foot), pskin: operated leg body points."""
    z = pleg[:, 2]
    L = {}
    L["tibialTub"] = extreme(pleg, ANT, (z > knee[2] + 30) & (z < knee[2] + 60))
    L["tibiaPost"] = extreme(pleg, POST, (z > knee[2] + 25) & (z < knee[2] + 50))
    zb = pskin[:, 2].max()
    foot = pskin[pskin[:, 2] > zb - 70]
    L["heel"] = extreme(foot, POST)
    L["foot"] = foot.mean(0)
    return L


def fracture_field(fx_lat, fx_med, amp=1.6):
    """Signed field f(p): > 0 on the proximal (head) side. Plane through the two fracture end points,
    containing the antero-posterior direction, with a small irregular ripple."""
    d = fx_med - fx_lat
    n = unit(np.cross(d, ANT))
    if n @ (MED + SUP) < 0:
        n = -n
    p0 = (fx_lat + fx_med) / 2
    t1 = unit(d)
    t2 = ANT

    def f(p):
        q = p - p0
        u, v = q @ t1, q @ t2
        ripple = amp * (np.sin(u / 6.3 + 0.7) * np.cos(v / 7.9) + 0.6 * np.sin(u / 3.1 - v / 4.7 + 1.9))
        return q @ n + ripple

    return f, n, p0


def split(mask, coords_fn, f):
    """Split a mask into proximal (f>0) and distal parts using voxel centre coordinates."""
    idx = np.argwhere(mask)
    pts = coords_fn(idx)
    side = f(pts) > 0
    prox = np.zeros_like(mask)
    dist = np.zeros_like(mask)
    prox[tuple(idx[side].T)] = True
    dist[tuple(idx[~side].T)] = True
    return prox, dist


def sdf_grid(mask, vox_origin, sp, box_lo, box_hi, step=2.0):
    """Signed distance (mm, negative inside) of a mask sampled on a regular grid in [box_lo, box_hi]."""
    lo = np.maximum(0, np.floor((box_lo - vox_origin) / sp).astype(int) - 3)
    hi = np.minimum(mask.shape, np.ceil((box_hi - vox_origin) / sp).astype(int) + 4)
    sub = mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    inside = ndi.distance_transform_edt(sub, sampling=sp)
    outside = ndi.distance_transform_edt(~sub, sampling=sp)
    sdf = outside - inside  # >0 outside, <0 inside (at voxel centres)
    sdf = np.where(sub, sdf + sp / 2, sdf - sp / 2)  # surface half-way between voxel centres
    org = vox_origin + lo * sp
    n = np.maximum(2, np.ceil((box_hi - box_lo) / step).astype(int) + 1)
    gx = [box_lo[a] + np.arange(n[a]) * step for a in range(3)]
    G = np.meshgrid(*gx, indexing="ij")
    idx = [(G[a] - org[a]) / sp for a in range(3)]
    vals = ndi.map_coordinates(sdf, idx, order=1, mode="nearest")
    return vals.astype(np.float32), n, step


def contact_points(mask, other, coords_fn, f, band=14.0, max_pts=700, seed=1):
    """Surface voxel centres of `mask` within `band` mm of the fracture plane."""
    surf = mask & ~ndi.binary_erosion(mask)
    idx = np.argwhere(surf)
    pts = coords_fn(idx)
    keep = np.abs(f(pts)) < band
    pts = pts[keep]
    rng = np.random.default_rng(seed)
    if len(pts) > max_pts:
        pts = pts[rng.choice(len(pts), max_pts, replace=False)]
    return pts.astype(np.float32)


def mass_props(pts, voxel_mm3, density=1.05e-6):
    """Mass (kg), centre of mass (mm) and inertia tensor (kg mm^2) of a voxel cloud."""
    m = len(pts) * voxel_mm3 * density
    c = pts.mean(0)
    d = pts - c
    I = (np.eye(3) * (d ** 2).sum() - d.T @ d) * voxel_mm3 * density
    return m, c, I
