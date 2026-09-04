#!/usr/bin/env python3
"""Classic HueForge reference implementation (corrected prompt, 2026-09-04).

Turns an arbitrary raster image into:
  * a watertight STL (stacked color sheets, per-color thicknesses), and
  * a filament-change schedule for a single-extruder FDM printer.

Implements the corrected classic-HueForge prompt in
docs/hueforge-classic-prompt.md: RGB nearest-color mapping (never grayscale),
user-chosen stack order, cumulative sheet-top heights, area-based cleanup,
ceil-rounded swap layers.

Dependencies: numpy, Pillow (required); scikit-image (optional: CLAHE + small
region cleanup); scikit-learn (optional: k-means auto-palette). The STL writer
is pure numpy, so no trimesh/numpy-stl is needed.

Usage:
  python hueforge_classic.py photo.png --palette "#111111 #4d4d4d #b0b0b0 #ffffff" \
      --heights 1.2,0.9,0.6,0.4 --layer-height 0.08 --out ./out
  python hueforge_classic.py --demo --out ./out     # built-in 4-color test
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install Pillow numpy")

try:
    from skimage.exposure import equalize_adapthist
    from skimage.color import rgb2lab, lab2rgb
    HAS_SKIMAGE = True
except ImportError:
    HAS_SKIMAGE = False

try:
    from sklearn.cluster import KMeans
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


# ---------------------------------------------------------------------------
# 1. Preprocessing (RGB - never grayscale)
# ---------------------------------------------------------------------------

def luma(rgb: np.ndarray) -> np.ndarray:
    """Rec.709 luma, 0..255, shape (H, W)."""
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def percentile_stretch(rgb: np.ndarray,
                       lo_pct: float = 1.0,
                       hi_pct: float = 99.0) -> np.ndarray:
    """Global contrast stretch driven by luma percentiles.

    A single gain/offset derived from the luma histogram is applied to all
    three channels, so hue is preserved (the hue-preservation rule).
    """
    y = luma(rgb)
    lo, hi = np.percentile(y, [lo_pct, hi_pct])
    if hi - lo < 1.0:
        return rgb
    gain = 255.0 / (hi - lo)
    offset = -lo * gain
    return np.clip(rgb * gain + offset, 0, 255).astype(np.uint8)


def clahe(rgb: np.ndarray) -> np.ndarray:
    """CLAHE on the L* channel of CIELAB (optional; needs scikit-image).

    Equalizing L* keeps hue and chroma intact - applying CLAHE per RGB
    channel would shift colors.
    """
    lab = rgb2lab(rgb)
    lab[..., 0] = equalize_adapthist(lab[..., 0], clip_limit=0.03) * 100.0
    out = lab2rgb(lab)
    return np.clip(out * 255.0, 0, 255).astype(np.uint8)


def preprocess(path: Path, sigma: float = 0.75,
               stretch: bool = True, use_clahe: bool = False) -> np.ndarray:
    """Load, resize (capped at 1000 px/side), denoise, enhance.

    Returns uint8 HxWx3. The resize keeps the print-bed pixel size ~=
    nozzle_diameter/2 as long as the image side stays under 1000 px.
    """
    img = Image.open(path).convert("RGB")
    scale = min(1.0, 1000.0 / max(img.width, img.height))
    img = img.resize((max(1, int(img.width * scale)),
                      max(1, int(img.height * scale))), Image.LANCZOS)
    if sigma > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=sigma))
    rgb = np.asarray(img, dtype=np.float32)
    if use_clahe:
        if HAS_SKIMAGE:
            rgb = clahe(rgb.astype(np.uint8)).astype(np.float32)
        else:
            print("  [warn] scikit-image not installed - skipping CLAHE")
    if stretch:
        rgb = percentile_stretch(rgb)
    return np.clip(rgb, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# 2. Color quantization to the filament palette
# ---------------------------------------------------------------------------

def redmean_distance(px: np.ndarray, pal: np.ndarray) -> np.ndarray:
    """Fast perceptual-ish distance (redmean approximation of CIE76)."""
    rmean = (px[..., 0:1] + pal[None, None, :, 0]) / 2.0
    dr = px[..., 0:1] - pal[None, None, :, 0]
    dg = px[..., 1:2] - pal[None, None, :, 1]
    db = px[..., 2:3] - pal[None, None, :, 2]
    # Each channel term is already (H, W, N); sum them elementwise so the
    # result stays (H, W, N) — one distance per palette entry.
    return ((2.0 + rmean / 256.0) * dr * dr + 4.0 * dg * dg
            + (2.0 + (255.0 - rmean) / 256.0) * db * db)


def _srgb_to_lab(c: np.ndarray) -> np.ndarray:
    """sRGB (0..255) -> CIELAB (D65)."""
    c = c.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = lin @ np.array([[0.4124564, 0.3575761, 0.1804375],
                          [0.2126729, 0.7151522, 0.0721750],
                          [0.0193339, 0.1191920, 0.9503041]])
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    return np.stack([116.0 * f[..., 1] - 16.0,
                     500.0 * (f[..., 0] - f[..., 1]),
                     200.0 * (f[..., 1] - f[..., 2])], axis=-1)


def ciede2000(l1: np.ndarray, l2: np.ndarray) -> np.ndarray:
    """Vectorized CIEDE2000 between two (...,3) Lab arrays (Sharma et al.)."""
    L1, a1, b1 = l1[..., 0], l1[..., 1], l1[..., 2]
    L2, a2, b2 = l2[..., 0], l2[..., 1], l2[..., 2]
    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    Cbar = (C1 + C2) / 2.0
    G = 0.5 * (1.0 - np.sqrt(Cbar**7 / (Cbar**7 + 25.0**7)))
    a1p = (1.0 + G) * a1
    a2p = (1.0 + G) * a2
    C1p = np.hypot(a1p, b1)
    C2p = np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0
    dLp = L2 - L1
    dCp = C2p - C1p
    dhp = np.where(C1p * C2p == 0, 0.0, h2p - h1p)
    dhp = np.where(dhp > 180.0, dhp - 360.0,
                   np.where(dhp < -180.0, dhp + 360.0, dhp))
    dHp = 2.0 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp) / 2.0)
    Lbarp = (L1 + L2) / 2.0
    Cbarp = (C1p + C2p) / 2.0
    hbarp = np.where(C1p * C2p == 0, h1p + h2p,
                     np.where(np.abs(h1p - h2p) <= 180.0, (h1p + h2p) / 2.0,
                              np.where(h1p + h2p < 360.0,
                                       (h1p + h2p + 360.0) / 2.0,
                                       (h1p + h2p - 360.0) / 2.0)))
    T = (1.0 - 0.17 * np.cos(np.radians(hbarp - 30.0))
         + 0.24 * np.cos(np.radians(2.0 * hbarp))
         + 0.32 * np.cos(np.radians(3.0 * hbarp + 6.0))
         - 0.20 * np.cos(np.radians(4.0 * hbarp - 63.0)))
    dtheta = 30.0 * np.exp(-((hbarp - 275.0) / 25.0) ** 2)
    Rc = 2.0 * np.sqrt(Cbarp**7 / (Cbarp**7 + 25.0**7))
    Sl = 1.0 + 0.015 * (Lbarp - 50.0) ** 2 / np.sqrt(20.0 + (Lbarp - 50.0) ** 2)
    Sc = 1.0 + 0.045 * Cbarp
    Sh = 1.0 + 0.015 * Cbarp * T
    Rt = -np.sin(np.radians(2.0 * dtheta)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2
                   + Rt * (dCp / Sc) * (dHp / Sh))


def nearest_color_map(rgb: np.ndarray, palette: np.ndarray,
                      metric: str = "redmean") -> np.ndarray:
    """Assign each pixel the nearest palette color. Returns label array HxW."""
    if metric == "ciede2000":
        lab_px = _srgb_to_lab(rgb)
        lab_pal = _srgb_to_lab(palette)
        dist = np.stack([
            ciede2000(lab_px, np.broadcast_to(lab_pal[i], lab_px.shape))
            for i in range(len(palette))
        ], axis=-1)
    else:
        dist = redmean_distance(rgb.astype(np.float32),
                                palette.astype(np.float32))
    return np.argmin(dist, axis=-1).astype(np.uint8)


def kmeans_palette(rgb: np.ndarray, n: int, seed: int = 0) -> np.ndarray:
    """Optional auto-palette: k-means (k=N) in RGB space, sorted dark->light.

    Fallback without scikit-learn: pick N colors with equal-population luma
    shares, matching the common dark->light stack order.
    """
    pixels = rgb.reshape(-1, 3).astype(np.float32)
    if HAS_SKLEARN:
        rng = np.random.RandomState(seed)
        sample = pixels[rng.choice(len(pixels),
                                   min(len(pixels), 200_000), replace=False)]
        km = KMeans(n_clusters=n, n_init=3, random_state=seed).fit(sample)
        pal = km.cluster_centers_
    else:
        order = np.argsort(luma(pixels))
        idx = np.linspace(0, len(order) - 1, n).astype(int)
        pal = pixels[order[idx]]
    return pal[np.argsort(luma(pal))].astype(np.uint8)


# ---------------------------------------------------------------------------
# 6. Detail cleanup: reassign tiny connected regions to a neighbor color
# ---------------------------------------------------------------------------

def cleanup_small_regions(labels: np.ndarray, min_area: int) -> np.ndarray:
    """Reassign connected components smaller than `min_area` pixels.

    Uses scikit-image labeling; without it the step is skipped with a warning
    (area-based cleanup is preferred over morphological opening, which erases
    thin lines).
    """
    if not HAS_SKIMAGE:
        print("  [warn] scikit-image not installed - skipping region cleanup")
        return labels
    from skimage.measure import label as cc_label
    lab, count = cc_label(labels, connectivity=2, return_num=True)
    if count <= 1:
        return labels
    out = labels.copy()
    for comp in range(1, count + 1):
        mask = lab == comp
        if mask.sum() >= min_area:
            continue
        y, x = np.nonzero(mask)
        votes = []
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            yy = np.clip(y + dy, 0, labels.shape[0] - 1)
            xx = np.clip(x + dx, 0, labels.shape[1] - 1)
            votes.append(labels[yy, xx][~mask[yy, xx]])
        votes = np.concatenate(votes)
        if votes.size:
            out[mask] = np.bincount(votes).argmax()
    return out


# ---------------------------------------------------------------------------
# 3. Per-color sheet heights + 4. heightmap
# ---------------------------------------------------------------------------

def sheet_thicknesses(n: int, heights: list[float] | None = None) -> list[float]:
    """Thickness per color (mm), bottom -> top.

    Default: linear falloff from 1.2 (bottom, blocks bleed) to 0.4 (top, thin
    and opaque with 100% infill). Every color is clamped to >= 0.4 mm.
    """
    if heights is None:
        heights = [1.2 - (1.2 - 0.4) * (i / max(1, n - 1)) for i in range(n)]
    if len(heights) != n:
        raise ValueError(f"expected {n} heights, got {len(heights)}")
    clamped = [max(0.4, h) for h in heights]
    if clamped != heights:
        print("  [warn] some thicknesses clamped up to 0.4 mm (opacity minimum)")
    return clamped


def snap_to_layer_grid(h: list[float], layer_height: float) -> list[float]:
    """Snap internal band boundaries to the layer grid.

    Every internal boundary (cumulative sheet top) moves to the nearest
    whole-layer top: round(ideal / layer_height) * layer_height. Boundaries
    are forced at least one layer apart. The final boundary (model top) is
    left at the exact user total. Returns adjusted per-color thicknesses so
    that geometry, swap schedule and the sliced G-code agree exactly.
    """
    cum = np.cumsum(h)
    total = float(cum[-1])
    snapped = [0.0]
    for c in cum[:-1]:
        z = round(float(c) / layer_height) * layer_height
        z = max(z, snapped[-1] + layer_height)
        snapped.append(round(z, 6))
    snapped.append(total)
    return [round(snapped[i + 1] - snapped[i], 6) for i in range(len(h))]


def build_heightmap(labels: np.ndarray, h: list[float]) -> np.ndarray:
    """z per pixel = cumulative sheet tops: color i -> h_0 + ... + h_i."""
    cum = np.cumsum(h)
    return cum[np.asarray(labels, dtype=int)]


# ---------------------------------------------------------------------------
# 5. Mesh: regular grid, 2 triangles/cell, walls + bottom -> watertight
# ---------------------------------------------------------------------------

def build_mesh(z: np.ndarray, px_mm: float):
    """Return (vertices Nx3, faces Mx3) with outward winding.

    Top face = the heightmap; a full bottom grid at z=0; vertical border
    walls between them. Every triangle edge is shared by exactly two
    triangles, so the mesh is watertight and edge-manifold (slicer-safe).
    All wall faces are vertical, so overhangs never occur and supports are
    not needed (every wall is <= 90 deg).
    """
    H, W = z.shape
    gw, gh = W + 1, H + 1                 # grid dims (vertices per side)
    verts = np.empty((gw * gh * 2, 3), dtype=np.float32)

    def top_id(cx: int, cy: int) -> int:
        return cy * gw + cx

    def base_id(cx: int, cy: int) -> int:
        return gw * gh + cy * gw + cx

    # Top grid (z from the heightmap) and bottom grid (z = 0).
    for cy in range(gh):
        for cx in range(gw):
            zz = z[min(cy, H - 1), min(cx, W - 1)]
            verts[top_id(cx, cy)] = (cx * px_mm, cy * px_mm, zz)
            verts[base_id(cx, cy)] = (cx * px_mm, cy * px_mm, 0.0)

    faces: list[tuple[int, int, int]] = []

    # Top faces: two triangles per cell, CCW viewed from +Z.
    for cy in range(H):
        for cx in range(W):
            p00 = top_id(cx, cy)
            p10 = top_id(cx + 1, cy)
            p11 = top_id(cx + 1, cy + 1)
            p01 = top_id(cx, cy + 1)
            faces.append((p00, p10, p11))
            faces.append((p00, p11, p01))

    # Bottom faces: same grid, CW viewed from +Z (normal -Z).
    for cy in range(H):
        for cx in range(W):
            b00 = base_id(cx, cy)
            b10 = base_id(cx + 1, cy)
            b11 = base_id(cx + 1, cy + 1)
            b01 = base_id(cx, cy + 1)
            faces.append((b00, b11, b10))
            faces.append((b00, b01, b11))

    # Border walls. Each edge is traversed A -> B so the outward normal is
    # (B - A) x +Z; each quad -> (A_base, B_top, A_top) + (A_base, B_base,
    # B_top). Adjacent quads share the vertical edges, the top grid shares
    # the top edges and the bottom grid the base edges - every edge appears
    # exactly twice.
    for cx in range(W):                      # south (y=0), dir +X -> -Y
        a, b = base_id(cx, 0), base_id(cx + 1, 0)
        at, bt = top_id(cx, 0), top_id(cx + 1, 0)
        faces += [(a, bt, at), (a, b, bt)]
    for cy in range(H):                      # east (x=W), dir +Y -> +X
        a, b = base_id(W, cy), base_id(W, cy + 1)
        at, bt = top_id(W, cy), top_id(W, cy + 1)
        faces += [(a, bt, at), (a, b, bt)]
    for cx in range(W - 1, -1, -1):          # north (y=H), dir -X -> +Y
        a, b = base_id(cx + 1, H), base_id(cx, H)
        at, bt = top_id(cx + 1, H), top_id(cx, H)
        faces += [(a, bt, at), (a, b, bt)]
    for cy in range(H - 1, -1, -1):          # west (x=0), dir -Y -> -X
        a, b = base_id(0, cy + 1), base_id(0, cy)
        at, bt = top_id(0, cy + 1), top_id(0, cy)
        faces += [(a, bt, at), (a, b, bt)]

    return verts, np.array(faces, dtype=np.int32)


def verify_watertight(faces: np.ndarray) -> bool:
    """Every edge must be shared by exactly two triangles."""
    edges = {}
    for (a, b, c) in faces.tolist():
        for e in ((a, b), (b, c), (c, a)):
            key = tuple(sorted(e))
            edges[key] = edges.get(key, 0) + 1
    return all(v == 2 for v in edges.values())


def write_binary_stl(verts: np.ndarray, faces: np.ndarray, path: Path) -> None:
    """Zero-dependency binary STL writer (same format as numpy-stl/trimesh).

    80-byte header, uint32 triangle count, then per triangle: 12 float32s
    (normal + 3 vertices) and a uint16 attribute count.
    """
    tri_verts = verts[faces]                  # (M, 3, 3)
    a, b, c = tri_verts[:, 0], tri_verts[:, 1], tri_verts[:, 2]
    n = np.cross(b - a, c - a)
    norm = np.linalg.norm(n, axis=1, keepdims=True)
    norm = np.where(norm == 0, 1.0, norm)
    n /= norm
    body = np.concatenate([n, tri_verts.reshape(-1, 9)], axis=1).astype("<f4")
    with open(path, "wb") as fh:
        fh.write(b"hueforge-classic" + b"\x00" * (80 - 16))
        fh.write(struct.pack("<I", len(faces)))
        for row in body:
            fh.write(row.tobytes())
            fh.write(b"\x00\x00")             # attribute byte count
    print(f"  STL written: {path} ({len(faces):,} triangles)")


# ---------------------------------------------------------------------------
# 7. Filament swap schedule
# ---------------------------------------------------------------------------

def swap_schedule(h: list[float], layer_height: float,
                  colors: list[str]) -> dict:
    """Per-color layer ranges and swap layers.

    Input heights are expected to come from snap_to_layer_grid(), so every
    internal boundary already sits exactly on a layer top. Color i (i >= 1)
    is swapped in at the start of that layer, i.e. before layer
    z_start / layer_height. Example: snapped h = [1.2, 0.88, 0.64, 0.38] at
    0.08 mm yields swaps at layers 15, 26, 34 (ideal [1.2, 0.9, 0.6, 0.4]
    gave 15, 27, 34 before snapping).
    """
    cum = np.cumsum(h)
    total = float(cum[-1])
    n = len(h)
    swaps = []                                # (layer, z_start, color_index)
    for i in range(1, n):
        z0 = float(cum[i - 1])
        layer = int(round(z0 / layer_height + 1e-9))
        swaps.append((layer, z0, i))
    ranges = []
    for i in range(n):
        z0 = 0.0 if i == 0 else float(cum[i - 1])
        z1 = float(cum[i])
        start = 1 if i == 0 else swaps[i - 1][0]
        end = (swaps[i][0] - 1 if i < n - 1
               else int(math.ceil(total / layer_height)))
        ranges.append({
            "color": colors[i],
            "index": i,
            "z_start_mm": round(z0, 3),
            "z_end_mm": round(z1, 3),
            "layers": [start, end],
            "layer_count": end - start + 1,
        })
    return {
        "total_height_mm": round(total, 3),
        "layer_height_mm": layer_height,
        "total_layers": int(math.ceil(total / layer_height)),
        "swaps": [{"at_layer": s[0], "z_mm": round(s[1], 3),
                   "to_color": colors[s[2]]} for s in swaps],
        "colors": ranges,
    }


def format_schedule(sched: dict) -> str:
    lines = ["=" * 50, "HueForge classic - print schedule", "=" * 50,
             f"Layer height: {sched['layer_height_mm']} mm  "
             f". total height: {sched['total_height_mm']} mm  "
             f". {sched['total_layers']} layers", "",
             "Colors (bottom -> top):"]
    for r in sched["colors"]:
        lines.append(f"  {r['index']}. {r['color']}  .  "
                     f"{r['z_start_mm']}-{r['z_end_mm']} mm  .  "
                     f"layers {r['layers'][0]}-{r['layers'][1]} "
                     f"({r['layer_count']})")
    lines += ["", "Filament swaps (change before printing the layer):"]
    for s in sched["swaps"]:
        lines.append(f"  Layer {s['at_layer']} (z = {s['z_mm']} mm): "
                     f"switch to {s['to_color']}")
    lines += ["", "Marlin / PrusaSlicer color-change lines "
                  "(insert before each layer):"]
    for s in sched["swaps"]:
        lines.append(f"  ; layer {s['at_layer']} - change to {s['to_color']}")
        lines.append("  M600")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Demo / CLI
# ---------------------------------------------------------------------------

def make_demo_image() -> Path:
    """4-color test image: horizontal bands dark (bottom) -> light (top)."""
    from PIL import Image as PILImage
    w = h = 300
    img = PILImage.new("RGB", (w, h))
    px = img.load()
    bands = [((0, 0, 0), 0.0, 0.40),          # black  (bottom, thickest)
             ((77, 77, 77), 0.40, 0.60),
             ((176, 176, 176), 0.60, 0.80),
             ((255, 255, 255), 0.80, 1.0)]    # white  (top, thinnest)
    for y in range(h):
        t = y / h
        for (col, lo, hi) in bands:
            if lo <= t < hi:
                for x in range(w):
                    px[x, y] = col
                break
    path = Path("hueforge_demo.png")
    img.save(path)
    return path


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Classic HueForge reference implementation")
    ap.add_argument("input", nargs="?", help="input image (PNG/JPG/WebP)")
    ap.add_argument("--demo", action="store_true",
                    help="run on a built-in test image")
    ap.add_argument("--palette",
                    help='filament colors bottom->top, e.g. '
                         '"#111111 #4d4d4d #b0b0b0 #ffffff"')
    ap.add_argument("--heights", help="per-color thicknesses in mm, "
                                      "e.g. 1.2,0.9,0.6,0.4")
    ap.add_argument("--layer-height", type=float, default=0.08)
    ap.add_argument("--nozzle", type=float, default=0.4)
    ap.add_argument("--metric", choices=["redmean", "ciede2000"],
                    default="redmean")
    ap.add_argument("--auto-palette", action="store_true",
                    help="k-means (k=N) palette from the image")
    ap.add_argument("--no-clahe", action="store_true")
    ap.add_argument("--min-area-frac", type=float, default=0.01,
                    help="small-region cleanup threshold (fraction of image)")
    ap.add_argument("--out", default="out")
    args = ap.parse_args()

    if not args.input and not args.demo:
        ap.error("provide an input image or use --demo")

    src = Path(args.input) if args.input else make_demo_image()
    if args.demo:
        print(f"Demo image: {src}")

    print(f"[1/6] Preprocess {src} (nozzle {args.nozzle} mm)")
    rgb = preprocess(src, sigma=0.75, use_clahe=not args.no_clahe)
    print(f"      image size: {rgb.shape[1]}x{rgb.shape[0]} px")

    if args.palette:
        colors = [c.strip().lstrip("#") for c in args.palette.split()]
        palette = np.array([[int(c[i:i + 2], 16) for i in (0, 2, 4)]
                            for c in colors], dtype=np.uint8)
    else:
        colors, palette = None, None
    if args.auto_palette or palette is None:
        n = len(colors) if colors else 4
        palette = kmeans_palette(rgb, n)
        colors = [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in palette]
        print(f"[2/6] Auto-palette (k-means k={n}): {', '.join(colors)}")
    else:
        print(f"[2/6] Palette (bottom -> top): {', '.join(colors)}")

    print(f"[3/6] Nearest-color mapping ({args.metric})")
    labels = nearest_color_map(rgb, palette, args.metric)

    min_area = max(1, int(rgb.shape[0] * rgb.shape[1] * args.min_area_frac))
    print(f"[4/6] Cleanup: reassign regions < {min_area} px")
    labels = cleanup_small_regions(labels, min_area)

    h = [float(x) for x in args.heights.split(",")] if args.heights else None
    h = sheet_thicknesses(len(palette), h)
    h_snap = snap_to_layer_grid(h, args.layer_height)
    if h_snap != h:
        print(f"[5/6] Sheet heights (mm): {h}  .  total {sum(h):.2f} mm")
        print(f"      snapped to layer grid ({args.layer_height} mm): {h_snap}")
    else:
        print(f"[5/6] Sheet heights (mm): {h}  .  total {sum(h):.2f} mm")

    px_mm = args.nozzle / 2.0
    z = build_heightmap(labels, h_snap)
    verts, faces = build_mesh(z, px_mm)
    if not verify_watertight(faces):
        print("  [error] mesh is NOT watertight")
        return 1
    print(f"      mesh watertight OK ({len(faces):,} triangles)")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_binary_stl(verts, faces, out_dir / "model.stl")

    sched = swap_schedule(h_snap, args.layer_height, colors)
    (out_dir / "schedule.json").write_text(json.dumps(sched, indent=2))
    (out_dir / "schedule.txt").write_text(format_schedule(sched))
    print(f"[6/6] Schedule written to {out_dir / 'schedule.json'} "
          f"and {out_dir / 'schedule.txt'}")
    print()
    print(format_schedule(sched))
    return 0


if __name__ == "__main__":
    sys.exit(main())
