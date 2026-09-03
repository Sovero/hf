# HueForge Web — Design

**Date:** 2026-09-02
**Status:** Implemented
**Product:** Browser app that turns any image into a multi-layer "filament painting" for 3D printing: upload → reduce to N colors (4/8/12/16, or custom 2–16) → stepped heightmap → download STL or 3MF, color encoded by layer height.

## Research & Best Practices

- **HueForge mechanism (validated):** a filament painting is a stack of thin color sheets; each color band sits at its own height, printed dark→light (or reversed), and the slicer's filament changes at layer boundaries produce the picture. Tallest surfaces = last-printed color. (shop.thehueforge.com, snapmaker.com/blog/hueforge-3d-printing, hueforge.wiki)
- **3MF color (validated):** the 3MF Core + Materials extensions encode per-triangle color via a `basematerials` resource and `pid`/`p1` attributes on `<triangle>`; slicers (Bambu/Prusa/Orca) read `displaycolor` for filament assignment. (github.com/3MFConsortium/spec_materials, modelrift.com/blog/multicolor-3mf-export)
- **STL carries no color** (blog.prusa3d.com) → our STL encodes color geometrically by layer height, exactly as HueForge does; the 3MF additionally carries palette + print order in metadata.

## Architecture

```
┌─────────────────────────── Browser (no server) ───────────────────────────┐
│                                                                           │
│  UI (src/ui/main.ts)          Pipeline (src/lib)            Exporters     │
│  ┌────────────────┐   File   ┌──────────────────┐          ┌───────────┐  │
│  │ drop zone /    │ ───────▶ │ loadImage (512px) │          │ exportStl │  │
│  │ options /      │          │      ▼            │  Mesh    │  (binary) │  │
│  │ palette panel  │          │ quantize (median  │ ───────▶ ├───────────┤  │
│  │ canvases       │          │  cut + redmean)   │          │ export3mf │  │
│  └───────┬────────┘          │      ▼            │          │  (fflate) │  │
│          │                   │ sortByLuminance   │          └───────────┘  │
│          ▼                   │      ▼            │                         │
│  ┌────────────────┐          │ buildHeightField  │                         │
│  │ Viewer3D       │ ◀────────│      ▼            │                         │
│  │ (three.js,     │  Mesh    │ buildMesh         │                         │
│  │  OrbitControls)│          │  (watertight)     │                         │
│  └────────────────┘          └──────────────────┘                          │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Frontend:** Vite + TypeScript, no framework — a handful of DOM panels is all the UI needs.
- **Processing:** pure functions on typed arrays (median-cut quantization, redmean nearest-color mapping, stepped height field, watertight mesh builder) — deterministic and unit-testable in Node.
- **Preview:** three.js `OrbitControls`; model group rotated −90° X so the print lies on a grid "bed".
- **Export:** binary STL (80-byte header + 50 B/triangle) and 3MF (zip via fflate; vertices deduplicated, per-triangle `pid="1" p1="materialIndex"`, palette + print order in `<metadata>`).

## Data Flow

1. Drop/browse image → `createImageBitmap` → canvas → RGBA `Uint8ClampedArray`, downscaled to ≤512 px on the long side (≈0.29 mm cells at 150 mm — FDM-appropriate; 4096 px would produce multi-GB STLs with no visible benefit at 0.4 mm nozzle).
2. Median-cut quantization to N colors (N = 4/8/12/16 or custom 2–16) → palette sorted by Rec.709 luminance (darkest → lightest).
3. Each pixel mapped to nearest palette color (redmean distance).
4. Height field: `z = base + band × step`, `step = (max − base)/(N − 1)`; band = `N−1−idx` (dark is tall) or `idx` (light is tall).
5. Mesh: top quad per cell + walls only at height discontinuities + per-cell bottom grid. Wall vertical edges are subdivided at all corner-cell heights ("zipper" strips), which makes the mesh watertight even where four cells of different heights meet.
6. Palette panel lists each color with hex, nearest common filament name, print order (#1 = first loaded), and top Z.
7. Export buttons produce binary STL / 3MF blobs for download.

## Key Decisions

- **One file, color by height** (user choice): single STL/3MF; the app's palette panel documents print order for manual filament swaps or AMS.
- **Hand-rolled mesh/export** instead of generic mesh libraries: the stepped heightmap topology (hidden-face culling, zipper walls, exact watertightness) is the core value; libraries fight you there.
- **Colors in 3MF as `basematerials`** (validated against the spec) plus palette/print-order `<metadata>`; STL stays colorless by format design.
- **Watertightness proven by test:** every mesh edge is shared by exactly 2 triangles, and the divergence-theorem volume equals Σ (cell area × cell height).

## Testing

- `src/test/pipeline.test.ts` — 15 unit tests, all passing: height bands both modes, mesh watertightness + signed volume + face colors, quantization (exact count, single-color image, index validity), luminance sort, hex round-trip, binary STL structure, 3MF zip structure + material references, print-order logic both modes.
- Verified end-to-end in the live preview: synthetic 256×256 image → 4- and 8-color reductions, 3D relief rendered, both exports generated (~13 MB STL, ~2 MB 3MF).

## Error Handling

- Non-image files and undecodable images → inline error in the status line.
- Custom color count clamped to 2–16; max height always kept above base.
- No server, no build-time env, works fully offline after load.

## Sources

- https://shop.thehueforge.com/pages/about-hueforge — filament painting mechanism
- https://www.snapmaker.com/blog/hueforge-3d-printing — layering / layer heights
- https://hueforge.wiki/index.php/FAQ — filament swap workflows
- https://github.com/3MFConsortium/spec_materials — basematerials / pid·p1 spec
- https://modelrift.com/blog/multicolor-3mf-export — practical multicolor 3MF notes
- https://blog.prusa3d.com/3mf-file-format-and-why-its-great_30986/ — STL vs 3MF
