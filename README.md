# HueForge Web

Browser app that turns an image into a multi-layer **filament painting** for 3D printing:
upload → reduce to any **2–24 colors** (slider) → stepped heightmap →
download **STL / 3MF**. Colors are encoded by layer height (HueForge-style).

## Quick start on a new PC

1. Install [Node.js LTS](https://nodejs.org) (one-time).
2. Download the latest **`hueforge-web-vX.Y.Z.zip`** from the
   [Releases page](https://github.com/Sovero/hf/releases) and unzip it.
3. Double-click **`install.bat`** inside the unzipped folder — it will:
   - check Node.js and **check for a newer release on GitHub** (offering to
     pull it automatically when one exists),
   - install all dependencies into the project folder,
   - offer to create a **desktop shortcut**,
   - start the app and open your browser.
4. Next time, just use the shortcut or double-click **`start.bat`** —
   it opens the browser at `http://127.0.0.1:5173`
   (and self-heals dependencies if the folder was moved or `node_modules` deleted).

Close the black console window to stop the server. The installed version is
shown in the app's top bar next to the title.

## Versioning & releases

- Versioning is **semantic** (`vMAJOR.MINOR.PATCH`). The single source of truth
  is `version` in `package.json`; every release tag must match it, and the
  release workflow refuses tags that don't.
- Cutting a release: bump `package.json`, commit, then

  ```bash
  git tag v0.2.0
  git push origin main --tags
  ```

  Pushing a `v*` tag triggers the **Release** workflow, which runs typecheck,
  tests and the production build, then creates a GitHub Release with an
  auto-generated changelog and a `hueforge-web-v0.2.0.zip` source archive
  (the committed tree — no `node_modules`/`dist`).
- `install.bat` compares your local version (from `package.json`) with the
  **latest GitHub release** on every run and offers to download and apply the
  update in place. No need to re-download the zip for updates — unless a new
  `install.bat`/`start.bat` ships, in which case a fresh unzip applies those.

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
npm test        # 23 unit tests (geometry, quantization, exports, printability)
npm run build   # production build to dist/
```

## Notes

- Everything runs **locally in the browser** — no server-side processing, images never leave the PC.
- Images are downscaled to 512 px on the long side before processing — this matches
  FDM resolution (≈0.3 mm cells at 150 mm width) and keeps files manageable.
- The mesh is watertight (verified by tests), so it slices cleanly.
