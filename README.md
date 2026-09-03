# HueForge Web

Browser app that turns an image into a multi-layer **filament painting** for 3D printing:
upload → reduce to any **2–24 colors** (slider) → stepped heightmap →
download **STL / 3MF**. Colors are encoded by layer height (HueForge-style).

## Quick start on a new PC

1. Install [Node.js LTS](https://nodejs.org) (one-time).
2. Double-click **`install.bat`** — it will:
   - check Node.js,
   - install all dependencies into the project folder,
   - offer to create a **desktop shortcut**,
   - start the app and open your browser.
3. Next time, just use the shortcut or double-click **`start.bat`** —
   it opens the browser at `http://127.0.0.1:5173`
   (and self-heals dependencies if the folder was moved or `node_modules` deleted).

Close the black console window to stop the server.

## How to use

1. **Drop an image** (PNG / JPG / WebP) into the panel on the left.
2. Pick the **number of colors** — any value from 2 to 24: drag the slider,
   click a tick preset, or type a count directly in the number box.
   Focus the slider to also use arrow keys (or type `1` `6` → 16 there).
3. Pick the **depth mode** — dark colors tallest (classic HueForge) or light tallest.
4. Adjust **size** (width/height in mm), base thickness and max height if needed.
5. Check the **printability panel** — it warns about too-thin color bands,
   features smaller than the nozzle, many filament changes, and fragile
   isolated regions, with concrete fixes for each.
6. Check the **palette panel** — it lists each color with its print order
   (#1 = first filament) and nearest filament name.
7. **Download STL** (color by layer height — set filament changes in your slicer
   at the Z heights shown in the palette panel) or **3MF** (same geometry,
   plus palette and print order embedded as metadata).

## Themes

Dark / Light / Nord / Solar — picker in the top bar, saved automatically.

## Development

```bash
npm install     # once
npm run dev     # dev server at http://127.0.0.1:5173
npm test        # 15 unit tests (geometry, quantization, exports)
npm run build   # production build to dist/
```

## Notes

- Everything runs **locally in the browser** — no server-side processing, images never leave the PC.
- Images are downscaled to 512 px on the long side before processing — this matches
  FDM resolution (≈0.3 mm cells at 150 mm width) and keeps files manageable.
- The mesh is watertight (verified by tests), so it slices cleanly.
