"""Leg positioning on the traction table.

A leg is turned about its femoral head centre: the femur moves as a rigid body and the soft tissue of the thigh
follows with a smooth blend weight (0 at the pelvis and trunk, 1 at the femur and thigh), so the pelvis bone is
never moved and there are no cut lines. Frame: mm, +x patient left, +y anterior, +z inferior.
"""
import numpy as np
import scipy.ndimage as ndi


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def rotmat(axis, ang):
    k = unit(axis)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K


def axis_angle(R):
    ang = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
    if ang < 1e-9:
        return np.array([1.0, 0, 0]), 0.0
    k = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * np.sin(ang))
    return unit(k), float(ang)


def traction_rotation(hc, knee, pcl_a, pcl_b, lat_sign, ir_deg=0.0):
    """Rotation about hc: hip extended (mechanical axis horizontal, coronal direction kept), leg turned so the
    posterior condylar line is horizontal (patella up), then internally rotated by ir_deg."""
    m = unit(np.asarray(knee) - hc)
    t = m.copy()
    t[1] = 0
    t = unit(t)
    k = np.cross(m, t)
    a = np.arcsin(np.clip(np.linalg.norm(k), -1, 1))
    R1 = rotmat(k, a) if a > 1e-6 else np.eye(3)
    p = R1 @ unit(np.asarray(pcl_b) - np.asarray(pcl_a))
    e2 = np.array([0, 1.0, 0])
    e1 = np.cross(e2, t)
    turn = -np.arctan2(p @ e2, p @ e1)
    if turn > np.pi / 2:
        turn -= np.pi
    if turn < -np.pi / 2:
        turn += np.pi
    R2 = rotmat(t, turn)
    med = np.array([-lat_sign, 0, 0.0])
    Rir = rotmat(t, np.radians(ir_deg))
    if (Rir @ e2) @ med < 0:  # internal rotation: the front of the thigh turns towards the midline
        Rir = rotmat(t, -np.radians(ir_deg))
    return Rir @ R2 @ R1


def lithotomy_rotation(lat_sign, flex_deg, abd_deg):
    """Well leg out of the beam: hip flexed (knee up = +y) then abducted (knee away from the midline)."""
    z = np.array([0, 0, 1.0])
    Rf = rotmat([1, 0, 0], np.radians(flex_deg))
    if (Rf @ z)[1] < 0:
        Rf = rotmat([1, 0, 0], -np.radians(flex_deg))
    v = Rf @ z
    Ra = rotmat([0, 0, 1], np.radians(abd_deg))
    if (Ra @ v)[0] * lat_sign < 0:
        Ra = rotmat([0, 0, 1], -np.radians(abd_deg))
    return Ra @ Rf


def weight_field(shape, sp, origin, femur_mask, fixed_mask, mask_sp, mask_origin, hc, axis, lat_sign, mid_x,
                 coarse=4.0, ramp=90.0):
    """Blend weight on a coarse grid covering the source volume (shape, sp, origin).
    Soft tissue follows the nearest bone: w = d_fixed / (d_fixed + d_femur), where d_femur is the distance to the
    moving femur and d_fixed the distance to the fixed bones (pelvis, spine, other femur). So the thigh follows
    its femur, the trunk stays, and the perineum and buttock blend gradually (no folds). The bones themselves are
    exact: femur 1, fixed bones 0. Returns (w, coarse, origin)."""
    cs = np.maximum(2, np.ceil(np.array(shape) * sp / coarse).astype(int))
    g = np.indices(cs, sparse=True)
    P = [g[i] * coarse + origin[i] for i in range(3)]

    def resample(m):
        I = np.broadcast_arrays(*[(P[i] - mask_origin[i]) / mask_sp for i in range(3)])
        return ndi.map_coordinates(m.astype(np.float32), I, order=1, cval=0) > 0.3

    F = ndi.binary_dilation(resample(femur_mask), iterations=1)
    X = ndi.binary_dilation(resample(fixed_mask), iterations=1) & ~F
    dF = ndi.distance_transform_edt(~F) * coarse
    dX = ndi.distance_transform_edt(~X) * coarse
    w = (dX / (dX + dF + 1e-6)).astype(np.float32)
    w = np.clip((w - 0.1) / 0.75, 0, 1)
    w = ndi.gaussian_filter(w, 1.5, mode='nearest')
    w[F] = 1
    w[X] = 0
    return w, coarse, np.asarray(origin, float)


class LegWarp:
    """Inverse map for one leg: output point p -> source point q = hc + R_w^T (p - hc), where R_w is the rotation
    R scaled by the blend weight at the source point (fixed-point iteration)."""

    def __init__(self, R, hc, w, wsp, worg):
        self.k, self.ang = axis_angle(R)
        self.hc, self.w, self.wsp, self.worg = np.asarray(hc, float), w, wsp, worg

    def __call__(self, p):
        d = p - self.hc
        q = p
        for _ in range(3):
            ww = ndi.map_coordinates(self.w, [(q[..., i] - self.worg[i]) / self.wsp for i in range(3)],
                                     order=1, mode='nearest')
            th = -self.ang * ww
            c, s = np.cos(th)[..., None], np.sin(th)[..., None]
            q = self.hc + d * c + np.cross(self.k, d) * s + self.k * (d @ self.k)[..., None] * (1 - c)
        return q


def lifted_leg(shape, sp, origin, femur_lift, femur_keep, mask_sp, mask_origin, hc, axis, s0=30.0, h=40.0,
               R=90.0, coarse=3.0):
    """The well leg is lifted out of the beam (hemilithotomy). Instead of bending it (which drags the other thigh),
    its thigh is removed beyond a rounded, convex stump end below its hip: in the region closer to the lifted femur
    than to the kept femur, everything further than s0 + h (1 - r^2/R^2) along the femoral axis is air
    (r = distance from the femoral axis, capped at R). The buttock stays. Returns a smooth 0..1 removal field on a
    coarse grid (field, step, origin)."""
    cs = np.maximum(2, np.ceil(np.array(shape) * sp / coarse).astype(int))
    g = np.indices(cs, sparse=True)
    P = [g[i] * coarse + origin[i] for i in range(3)]

    def resample(m):
        I = np.broadcast_arrays(*[(P[i] - mask_origin[i]) / mask_sp for i in range(3)])
        return ndi.map_coordinates(m.astype(np.float32), I, order=1, cval=0) > 0.3

    dL = ndi.distance_transform_edt(~resample(femur_lift)) * coarse
    dK = ndi.distance_transform_edt(~resample(femur_keep)) * coarse
    d = [P[i] - hc[i] for i in range(3)]
    s = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
    r2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - s ** 2
    beyond = s - (s0 + h * (1 - np.minimum(r2, R * R) / (R * R)))
    rem = ((dL < dK) & (beyond > 0)).astype(np.float32)
    rem = ndi.gaussian_filter(rem, 1.0)
    return rem, coarse, np.asarray(origin, float)
