"""Download the CT used by the lateral viewer and segment its bones.

CT: autoPET / FDG-PET-CT-Lesions (TCIA), patient PETCT_d3dac0d1cd, series "GK p.v.1 WF"
    (woman, 75 years; whole-body CT, 1 mm slices every 0.7 mm, 0.86 mm pixels, B30f, IV contrast, portal-venous).
    Licence CC BY 4.0. Gatidis S, Hepp T, Frueh M, et al. A whole-body FDG-PET/CT dataset with manually annotated
    tumor lesions. Sci Data 2022;9:601. doi:10.1038/s41597-022-01718-3. Data: doi:10.7937/gkr0-xv29.
    Downloaded from the NCI Imaging Data Commons (idc-index, public AWS bucket).

Usage:  python fetch_ct.py <work_dir>
Writes  <work_dir>/ct.nii.gz (full resolution), <work_dir>/ct15.nii.gz (1.5 mm copy for segmentation)
        and runs TotalSegmentator into <work_dir>/seg/.
Needs:  pip install idc-index pydicom nibabel scipy TotalSegmentator
TotalSegmentator: Wasserthal J et al. Radiol Artif Intell 2023;5:e230024.
"""
import glob
import os
import subprocess
import sys

import nibabel as nib
import numpy as np
import pydicom
import scipy.ndimage as ndi

PATIENT = 'PETCT_d3dac0d1cd'
SERIES = 'GK p.v.1 WF'


def download(work):
    from idc_index import IDCClient
    c = IDCClient()
    d = c.index
    s = d[(d.PatientID == PATIENT) & (d.Modality == 'CT') & (d.SeriesDescription == SERIES)]
    assert len(s) == 1, s
    out = os.path.join(work, 'dicom')
    c.download_from_selection(seriesInstanceUID=list(s.SeriesInstanceUID), downloadDir=out, dirTemplate='')
    return out


def to_nifti(folder, path):
    """DICOM series -> NIfTI. Array axes: i -> patient Left, j -> Anterior, k -> Inferior."""
    files = sorted(glob.glob(os.path.join(folder, '*.dcm')))
    hdr = [(f, pydicom.dcmread(f, stop_before_pixels=True)) for f in files]
    hdr.sort(key=lambda t: -float(t[1].ImagePositionPatient[2]))
    ds0 = hdr[0][1]
    assert [round(float(v)) for v in ds0.ImageOrientationPatient] == [1, 0, 0, 0, 1, 0]
    zs = np.array([float(h.ImagePositionPatient[2]) for _, h in hdr])
    dz = float(np.median(-np.diff(zs)))
    ps = [float(v) for v in ds0.PixelSpacing]
    sl = []
    for f, _ in hdr:
        d = pydicom.dcmread(f)
        sl.append((d.pixel_array.astype(np.float32) * float(d.RescaleSlope) + float(d.RescaleIntercept)).astype(np.int16))
    vol = np.stack(sl, -1).transpose(1, 0, 2)[:, ::-1, :]  # [x (left), y (anterior), k (inferior)]
    ipp = np.array([float(v) for v in ds0.ImagePositionPatient])
    lps0 = np.array([ipp[0], ipp[1] + (vol.shape[1] - 1) * ps[0], zs[0]])
    aff = np.diag([-ps[1], ps[0], -dz, 1.0])
    aff[:3, 3] = [-lps0[0], -lps0[1], lps0[2]]  # LPS -> RAS
    nib.save(nib.Nifti1Image(np.ascontiguousarray(vol), aff), path)


def resample15(src, dst):
    im = nib.load(src)
    v = np.asanyarray(im.dataobj).astype(np.float32)
    sp = np.abs(np.diag(im.affine)[:3])
    f = sp / 1.5
    v = ndi.gaussian_filter(v, 0.5 / f)
    out = ndi.zoom(v, f, order=1).astype(np.int16)
    aff = im.affine.copy()
    aff[:3, :3] = np.diag(np.sign(np.diag(im.affine)[:3]) * 1.5)
    nib.save(nib.Nifti1Image(out, aff), dst)


if __name__ == '__main__':
    work = sys.argv[1]
    os.makedirs(work, exist_ok=True)
    to_nifti(download(work), os.path.join(work, 'ct.nii.gz'))
    resample15(os.path.join(work, 'ct.nii.gz'), os.path.join(work, 'ct15.nii.gz'))
    subprocess.run(['TotalSegmentator', '-i', os.path.join(work, 'ct15.nii.gz'), '-o', os.path.join(work, 'seg'),
                    '--roi_subset', 'femur_left', 'femur_right', 'hip_left', 'hip_right', 'sacrum',
                    'vertebrae_L5', 'vertebrae_L4', 'vertebrae_S1', '-ns', '1', '-nr', '1'], check=True)
