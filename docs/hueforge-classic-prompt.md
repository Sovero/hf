# Classic HueForge — Reference Implementation Prompt

> Corrected 2026-09-04. This describes the **classic HueForge** method (stacked
> color sheets, user-chosen palette order, per-color thicknesses). The app in
> this repo implements the **brightness-relief** model instead (smooth
> brightness → height, one color per layer) — the two are different
> HueForge-family approaches; see the notes at the bottom.
>
> Reusable prompt: paste everything between the markers below into any AI.

---

```
You are an expert in HueForge 3D printing and computer graphics. Describe a
step-by-step algorithm (with Python pseudocode) that turns an arbitrary
raster image into a printable STL plus a filament-change schedule for a
single-extruder FDM printer.

Parameters:
- N filament colors (user-defined, each with a hex color)
- layer_height (e.g. 0.08 mm)
- width_mm x height_mm (e.g. 150x150)
- nozzle_diameter (e.g. 0.4 mm)

1. Preprocessing (optional, in RGB — never convert to grayscale):
   - Resize so ~1 pixel ≈ nozzle_diameter/2 (0.2 mm at 0.4 nozzle).
   - Stretch contrast (1–99% percentile or CLAHE).
   - Light Gaussian blur (sigma ≈ 0.5–1 px) for denoising.
   - Cap at ~1000×1000 pixels for speed.

2. Color quantization:
   - Assign each pixel the nearest filament color by perceptual distance
     (CIEDE2000 preferred; weighted RGB / redmean is a fast approximation).
   - If the palette is not fixed, derive N colors from the image with
     k-means (k=N) in RGB space.
   - The stack order (which color is printed first = bottom) is a user
     choice; dark→light is the common default because it reads correctly
     from the top.

3. Per-color sheet heights:
   - Each color prints as a full-footprint sheet; every color must be
     ≥ 0.4–0.5 mm for opacity.
   - Bottom colors thicker (0.8–1.5 mm) to block bleed-through; top colors
     thinner (0.4–0.6 mm).
   - Example N=4 dark→light: h = [1.2, 0.9, 0.6, 0.4] mm; total model
     height = sum of h.

4. Heightmap:
   - A pixel of color i has height z = h_0 + … + h_i (its sheet top).
   - Pixels of color 0 (bottom sheet): z = h_0.

5. Mesh:
   - Regular vertex grid at pixel pitch; z from the heightmap.
   - Two triangles per cell; vertical walls and a closed bottom → watertight.
   - Export via trimesh / numpy-stl.
   - Optional cautious smoothing; keep color boundaries sharp.

6. Detail cleanup (optional):
   - Reassign connected color regions smaller than a minimum area
     (e.g. < 1–2% of the image, or a few mm²) to a neighboring color.
   - Prefer area-based cleanup over morphological opening, which can erase
     thin intentional lines.

7. Filament swap schedule:
   - Snap every internal boundary to the layer grid first:
     z_i = round(z_i_ideal / layer_height) * layer_height, forced strictly
     increasing (each >= one layer above the previous). Only whole-layer
     multiples can print exactly — with 0.08 mm layers, boundary 2.1 mm
     (26.25 layers) can never align. The model top stays at the exact total.
   - Color i occupies layers z_start/layer_height … z_end/layer_height,
     where z_start = sum_{j<i} h_j and z_end = z_start + h_i (both snapped).
   - Swap to color i at the start of layer z_start/layer_height.
   - Example (N=4, 0.08 mm layers, h = [1.2, 0.88, 0.64, 0.38] snapped from
     [1.2, 0.9, 0.6, 0.4]): swaps at layers 15 (z=1.2), 26 (z=2.08),
     34 (z=2.72).
   - Emit M600 (Marlin / PrusaSlicer color change) or Cura pause-at-height.

8. Outputs:
   - STL (print top face up; no supports needed — all walls ≤ 90°;
     100% infill).
   - JSON/txt file with color order, swap heights and layer numbers.
   - Slicer recommendations (temperature, speed, infill).
```

---

## Why the original draft was corrected

1. **No grayscale conversion.** HueForge is a color process: pixels map to the
   nearest filament color. Converting to grayscale and k-means-clustering
   *brightness* destroys hue information. Grayscale is only valid if the
   source image is inherently monochrome.
2. **Palette order is a user choice**, not "sorted by mean brightness".
3. **Stacking semantics made explicit**: pixel height = cumulative sheet tops,
   not a brightness→height mapping (that is the *other*, brightness-relief
   model).
4. **Area-based cleanup instead of morphological opening** for small-color
   removal.
5. **Concrete example numbers**: after grid snapping, swap layers 15 / 26 / 34 at 0.08 mm (ideal boundaries 1.2 / 2.1 / 2.7 → snapped 1.2 / 2.08 / 2.72).
6. Layer rounding is **up** (ceil), printer firmware notes (M600 vs Cura).

## Relationship to this repo's app

| Concern | Classic HueForge (this prompt) | App (brightness-relief) |
| --- | --- | --- |
| Geometry | Flat stacked sheets, plateau relief | Smooth per-pixel brightness relief |
| Palette order | User-chosen | Auto dark→light (depth mode inverts) |
| Thicknesses | Per-color, user-tunable | Equal-population bands (min area per color) |
| Swap schedule | Cumulative sheet tops | Grid-snapped band tops |
| Outputs | STL + JSON/txt | STL + 3MF (Bambu project) + Describe.txt |
| Watertight mesh | Yes | Yes |

Both are valid HueForge-family approaches; they print differently on the
plate. If a classic mode is ever added to the app, this prompt is its spec.
