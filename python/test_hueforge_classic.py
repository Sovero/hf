"""pytest suite for the HueForge classic reference implementation.

Run from the repo root:
    python -m pytest python/test_hueforge_classic.py -q
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hueforge_classic as hf


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_image(blocks):
    """(H, W, 3) uint8 image from [(y0, y1, x0, x1, (r, g, b)), ...]."""
    H = max(b[1] for b in blocks)
    W = max(b[3] for b in blocks)
    img = np.zeros((H, W, 3), dtype=np.uint8)
    for y0, y1, x0, x1, rgb in blocks:
        img[y0:y1, x0:x1] = rgb
    return img


def parse_stl(path):
    data = Path(path).read_bytes()
    assert len(data) >= 84
    header = data[:80]
    n = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + 50 * n
    # each 50-byte record = 12 float32 (normal + 3 verts) + 2 attribute bytes
    rec = np.frombuffer(data, dtype=np.uint8, offset=84).reshape(n, 50)
    tris = rec[:, 12:48].copy().view("<f4").reshape(n, 3, 3)
    return header, tris


# ---------------------------------------------------------------------------
# Sheet heights + layer-grid snapping
# ---------------------------------------------------------------------------

class TestSheetThicknesses:
    def test_default_falloff(self):
        assert hf.sheet_thicknesses(4) == pytest.approx(
            [1.2, 0.9333333, 0.6666667, 0.4])

    def test_single_color(self):
        assert hf.sheet_thicknesses(1) == [1.2]

    def test_clamps_to_opacity_minimum(self):
        assert hf.sheet_thicknesses(2, [0.2, 1.0]) == [0.4, 1.0]

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            hf.sheet_thicknesses(4, [1.0, 1.0])


class TestSnapToLayerGrid:
    def test_exact_multiples_unchanged(self):
        assert hf.snap_to_layer_grid([0.8, 0.4], 0.2) == [0.8, 0.4]

    def test_demo_example_snaps(self):
        # ideal [1.2, 0.9, 0.6, 0.4] -> boundaries 1.2 / 2.08 / 2.72
        assert hf.snap_to_layer_grid([1.2, 0.9, 0.6, 0.4], 0.08) == \
            pytest.approx([1.2, 0.88, 0.64, 0.38])

    def test_total_height_preserved(self):
        h = [1.2, 0.9, 0.6, 0.4]
        assert sum(hf.snap_to_layer_grid(h, 0.08)) == pytest.approx(sum(h))

    @pytest.mark.parametrize("h,lh", [
        ([1.2, 0.9, 0.6, 0.4], 0.08),
        ([0.8, 0.15, 0.25], 0.2),
        ([1.0, 1.0, 1.0], 0.1),
        ([0.45, 0.45, 0.45, 0.45], 0.12),
    ])
    def test_internal_boundaries_on_grid_and_increasing(self, h, lh):
        out = hf.snap_to_layer_grid(h, lh)
        cum = list(np.cumsum([0.0] + out))
        for a, b in zip(cum[1:-1], cum[2:-1]):
            assert abs(a / lh - round(a / lh)) < 1e-9   # whole-layer top
            assert b - a >= lh - 1e-9                   # strictly increasing
        assert cum[-1] == pytest.approx(sum(h))         # model top untouched

    def test_degenerate_thin_bands_forced_apart(self):
        # ideal boundaries 0.8 / 0.9 are closer than one 0.2 layer
        out = hf.snap_to_layer_grid([0.8, 0.1, 0.1], 0.2)
        assert sum(out) == pytest.approx(1.0)
        cum = list(np.cumsum([0.0] + out))
        assert cum[2] - cum[1] >= 0.2 - 1e-9


# ---------------------------------------------------------------------------
# Heightmap
# ---------------------------------------------------------------------------

class TestHeightmap:
    def test_cumulative_sheet_tops(self):
        labels = np.array([[0, 2], [3, 1]])
        z = hf.build_heightmap(labels, [1.2, 0.88, 0.64, 0.38])
        assert z.tolist() == [[1.2, 2.72], [3.1, 2.08]]

    def test_plateau_tops_are_layer_multiples(self):
        rng = np.random.RandomState(3)
        labels = rng.randint(0, 4, size=(20, 20))
        h = hf.snap_to_layer_grid([1.2, 0.9, 0.6, 0.4], 0.08)
        z = hf.build_heightmap(labels, h)
        for v in np.unique(z):
            if v == z.max():                     # model top stays at exact total
                continue
            assert abs(v / 0.08 - round(v / 0.08)) < 1e-9


# ---------------------------------------------------------------------------
# Mesh + watertightness
# ---------------------------------------------------------------------------

class TestMesh:
    def test_watertight_2x2(self):
        z = np.ones((2, 2))
        _, faces = hf.build_mesh(z, 0.2)
        assert len(faces) == 32                     # 4HW + 4W + 4H
        assert hf.verify_watertight(faces)

    def test_watertight_4x5_varied(self):
        z = np.random.RandomState(1).rand(4, 5) * 3
        _, faces = hf.build_mesh(z, 0.2)
        assert len(faces) == 4 * 4 * 5 + 4 * 5 + 4 * 4
        assert hf.verify_watertight(faces)

    @pytest.mark.parametrize("shape", [(2, 2), (1, 3), (3, 1), (7, 9)])
    def test_watertight_various_shapes(self, shape):
        rng = np.random.RandomState(0)
        z = rng.randint(0, 30, size=shape) * 0.1
        _, faces = hf.build_mesh(z, 0.2)
        assert hf.verify_watertight(faces)

    def test_extents_and_base_plane(self):
        z = np.array([[0.0, 1.2], [2.08, 3.1]])
        verts, _ = hf.build_mesh(z, 0.5)
        H, W = z.shape
        gw, gh = W + 1, H + 1
        base = verts[gw * gh:]                      # bottom grid
        assert base[:, 2].min() == base[:, 2].max() == 0.0
        assert float(verts[:, 2].max()) == pytest.approx(float(z.max()))
        top = verts[:gw * gh].reshape(gh, gw, 3)
        assert top[0, 0, 2] == 0.0
        assert float(top[H, W, 2]) == pytest.approx(float(z[H - 1, W - 1]))

    def test_missing_face_breaks_watertight(self):
        z = np.ones((3, 3))
        _, faces = hf.build_mesh(z, 0.2)
        assert hf.verify_watertight(faces)
        assert not hf.verify_watertight(faces[1:])  # dropped triangle -> holes

    def test_no_overhangs(self):
        # all side walls must be vertical: only top faces slope
        z = np.random.RandomState(5).rand(6, 6) * 2
        verts, faces = hf.build_mesh(z, 0.2)
        a = verts[faces[:, 0]]
        b = verts[faces[:, 1]]
        c = verts[faces[:, 2]]
        norm = np.cross(b - a, c - a)
        # vertical walls have zero z-component in their normal
        vertical = np.abs(norm[:, 2]) < 1e-4
        # every non-top face is a vertical wall
        assert vertical.sum() >= 4 * (6 + 6)        # border walls, 2 tris each
        # every triangle has a non-degenerate area
        assert np.linalg.norm(norm, axis=1).min() > 1e-9


class TestStlWriter:
    def test_roundtrip(self, tmp_path):
        verts, faces = hf.build_mesh(
            np.random.RandomState(2).rand(5, 6) * 2, 0.25)
        out = tmp_path / "model.stl"
        hf.write_binary_stl(verts, faces, out)
        header, tris = parse_stl(out)
        assert header[:16] == b"hueforge-classic"
        assert len(tris) == len(faces)
        assert np.allclose(tris.reshape(-1, 3),
                           verts[faces].reshape(-1, 3), atol=1e-4)


# ---------------------------------------------------------------------------
# Swap schedule
# ---------------------------------------------------------------------------

class TestSwapSchedule:
    def test_demo_schedule(self):
        sched = hf.swap_schedule(
            [1.2, 0.88, 0.64, 0.38], 0.08,
            ["111111", "4d4d4d", "b0b0b0", "ffffff"])
        assert sched["total_height_mm"] == 3.1
        assert sched["total_layers"] == 39
        assert sched["swaps"] == [
            {"at_layer": 15, "z_mm": 1.2, "to_color": "4d4d4d"},
            {"at_layer": 26, "z_mm": 2.08, "to_color": "b0b0b0"},
            {"at_layer": 34, "z_mm": 2.72, "to_color": "ffffff"},
        ]
        assert [(r["layers"], r["layer_count"]) for r in sched["colors"]] == \
            [([1, 14], 14), ([15, 25], 11), ([26, 33], 8), ([34, 39], 6)]

    def test_ranges_contiguous_and_cover_every_layer(self):
        sched = hf.swap_schedule([1.2, 0.88, 0.64, 0.38], 0.08,
                                 ["a", "b", "c", "d"])
        ranges = sched["colors"]
        for a, b in zip(ranges, ranges[1:]):
            assert a["layers"][1] + 1 == b["layers"][0]
        assert sum(r["layer_count"] for r in ranges) == sched["total_layers"]
        assert ranges[0]["layers"][0] == 1
        assert ranges[-1]["layers"][1] == sched["total_layers"]

    @pytest.mark.parametrize("h,lh", [
        ([1.2, 0.88, 0.64, 0.38], 0.08),
        ([0.8, 0.2, 0.2], 0.2),
        ([0.48, 0.48, 0.36, 0.48], 0.12),
    ])
    def test_swap_layers_are_exact_layer_numbers(self, h, lh):
        sched = hf.swap_schedule(h, lh, ["x"] * len(h))
        for s in sched["swaps"]:
            assert s["at_layer"] * lh == pytest.approx(s["z_mm"])
            assert abs(s["z_mm"] / lh - round(s["z_mm"] / lh)) < 1e-9

    def test_single_color_has_no_swaps(self):
        sched = hf.swap_schedule([1.2], 0.08, ["000000"])
        assert sched["swaps"] == []
        assert sched["colors"][0]["layers"] == [1, 15]
        assert sched["colors"][0]["layer_count"] == 15

    def test_unsnapped_input_still_gives_whole_layers(self):
        # even if fed ideal (unsnapped) heights, swap layers are whole numbers
        sched = hf.swap_schedule([1.2, 0.9, 0.6, 0.4], 0.08, ["a", "b", "c", "d"])
        assert [s["at_layer"] for s in sched["swaps"]] == [15, 26, 34]
        assert all(s["at_layer"] == round(s["z_mm"] / 0.08) for s in sched["swaps"])

    def test_format_schedule_has_m600_per_swap(self):
        sched = hf.swap_schedule([1.2, 0.88, 0.64, 0.38], 0.08,
                                 ["a", "b", "c", "d"])
        txt = hf.format_schedule(sched)
        assert txt.count("M600") == len(sched["swaps"])
        assert "Layer 26 (z = 2.08 mm)" in txt


# ---------------------------------------------------------------------------
# Color quantization / palette mapping
# ---------------------------------------------------------------------------

class TestColorMapping:
    def test_redmean_distance_shape_and_order(self):
        px = np.zeros((3, 4, 3), dtype=np.float32)
        pal = np.array([[10, 20, 30], [200, 100, 50]], dtype=np.float32)
        d = hf.redmean_distance(px, pal)
        assert d.shape == (3, 4, 2)
        assert np.all(d[..., 1] > d[..., 0])       # (0,0,0) closer to dark

    def test_nearest_color_map_quadrants(self):
        img = make_image([
            (0, 10, 0, 10, (255, 0, 0)),           # red
            (0, 10, 10, 20, (0, 0, 255)),          # blue
            (10, 20, 0, 10, (0, 255, 0)),          # green
            (10, 20, 10, 20, (255, 255, 255)),     # white
        ])
        pal = np.array([[255, 0, 0], [0, 0, 255],
                        [0, 255, 0], [255, 255, 255]], dtype=np.uint8)
        labels = hf.nearest_color_map(img, pal, "redmean")
        assert labels[5, 5] == 0
        assert labels[5, 15] == 1
        assert labels[15, 5] == 2
        assert labels[15, 15] == 3

    def test_metrics_agree_on_exact_palette_colors(self):
        img = make_image([
            (0, 8, 0, 8, (120, 40, 200)),
            (0, 8, 8, 16, (30, 200, 90)),
        ])
        pal = np.array([[120, 40, 200], [30, 200, 90]], dtype=np.uint8)
        a = hf.nearest_color_map(img, pal, "redmean")
        b = hf.nearest_color_map(img, pal, "ciede2000")
        assert np.array_equal(a, b)

    def test_ciede2000_basics(self):
        red = hf._srgb_to_lab(np.array([[255, 0, 0]], dtype=np.float32))
        green = hf._srgb_to_lab(np.array([[0, 255, 0]], dtype=np.float32))
        assert hf.ciede2000(red, red)[0] == pytest.approx(0.0)
        assert hf.ciede2000(red, green)[0] > 10.0
        assert hf.ciede2000(red, green) == pytest.approx(
            hf.ciede2000(green, red))

    def test_ciede2000_known_pair(self):
        # Sharma et al. worked example: dE00 = 2.0425
        lab1 = np.array([[50.0, 2.6772, -79.7751]])
        lab2 = np.array([[50.0, 0.0, -82.7485]])
        assert hf.ciede2000(lab1, lab2)[0] == pytest.approx(2.0425, abs=1e-3)

    def test_kmeans_palette_sorted_and_reproduces_blocks(self):
        img = make_image([
            (0, 30, 0, 20, (255, 0, 0)),           # red
            (0, 30, 20, 40, (0, 255, 0)),          # green
            (0, 30, 40, 60, (0, 0, 255)),          # blue
        ])
        pal = hf.kmeans_palette(img, 3, seed=0)
        assert pal.shape == (3, 3) and pal.dtype == np.uint8
        lum = hf.luma(pal)
        assert list(lum) == sorted(lum)            # dark -> light
        expected = np.array([[0, 0, 255], [255, 0, 0],
                             [0, 255, 0]], dtype=np.float32)  # blue < red < green
        for got, want in zip(pal, expected):
            assert np.abs(got - want).max() < 40


# ---------------------------------------------------------------------------
# Detail cleanup (needs scikit-image)
# ---------------------------------------------------------------------------

class TestCleanupSmallRegions:
    def test_tiny_region_reassigned(self):
        skimage = pytest.importorskip("skimage")
        labels = np.zeros((6, 6), dtype=np.uint8)
        labels[2, 2] = 1                            # 1-px blob (area 1)
        labels[4:6, 4:6] = 2                        # 2x2 blob (area 4)
        out = hf.cleanup_small_regions(labels, min_area=2)
        assert out[2, 2] == 0                       # tiny blob absorbed by 0
        assert np.all(out[4:6, 4:6] == 2)           # big blob kept

    def test_large_regions_untouched(self):
        skimage = pytest.importorskip("skimage")
        labels = np.zeros((10, 10), dtype=np.uint8)
        labels[0:5, 0:5] = 3
        out = hf.cleanup_small_regions(labels, min_area=10)
        assert np.all(out[0:5, 0:5] == 3)


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

class TestPreprocess:
    def test_resize_cap_and_dtype(self, tmp_path):
        from PIL import Image
        big = Image.new("RGB", (2000, 100), (200, 30, 30))
        src = tmp_path / "big.png"
        big.save(src)
        rgb = hf.preprocess(src, sigma=0.0, stretch=False)
        assert rgb.dtype == np.uint8
        assert rgb.shape == (50, 1000, 3)           # capped at 1000 px/side
        assert rgb.shape[2] == 3

    def test_percentile_stretch_preserves_hue(self, tmp_path):
        # a low-contrast blue-ish image gains contrast but stays blue
        from PIL import Image
        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        arr[..., 0] = np.linspace(10, 90, 20, dtype=np.uint8)[:, None]
        arr[..., 2] = 200
        src = tmp_path / "flat.png"
        Image.fromarray(arr).save(src)
        out = hf.preprocess(src, sigma=0.0, stretch=True)
        assert out[..., 0].std() > arr[..., 0].std()   # contrast stretched
        assert out[..., 2].mean() > out[..., 0].mean()  # still blue-dominant


# ---------------------------------------------------------------------------
# End-to-end: the full demo pipeline
# ---------------------------------------------------------------------------

class TestDemoPipeline:
    def test_full_run(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(sys, "argv", [
            "hueforge_classic.py", "--demo",
            "--palette", "#111111 #4d4d4d #b0b0b0 #ffffff",
            "--heights", "1.2,0.9,0.6,0.4",
            "--layer-height", "0.08",
            "--out", "out",
        ])
        assert hf.main() == 0
        capsys.readouterr()                          # swallow progress output
        out = tmp_path / "out"
        assert (out / "model.stl").exists()
        assert (out / "schedule.json").exists()
        assert (out / "schedule.txt").exists()

        sched = json.loads((out / "schedule.json").read_text())
        assert [s["at_layer"] for s in sched["swaps"]] == [15, 26, 34]
        assert sched["total_layers"] == 39

        header, tris = parse_stl(out / "model.stl")
        assert header[:16] == b"hueforge-classic"
        assert tris.shape[0] == 362400              # 300x300 grid
        assert abs(tris[..., 2].max() - 3.1) < 1e-3
        assert tris[..., 2].min() == 0.0

        txt = (out / "schedule.txt").read_text()
        assert txt.count("M600") == 3
        assert "Layer 26 (z = 2.08 mm)" in txt

    def test_auto_palette_run(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(sys, "argv", [
            "hueforge_classic.py", "--demo", "--auto-palette",
            "--layer-height", "0.08", "--out", "out",
        ])
        assert hf.main() == 0
        capsys.readouterr()
        sched = json.loads((tmp_path / "out" / "schedule.json").read_text())
        assert len(sched["colors"]) == 4            # default k = 4
        assert sched["total_layers"] == 40         # default heights sum 3.2 mm
