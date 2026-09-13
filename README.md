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

> **Private repository:** this repo is private, so the update check needs a
> one-time GitHub token. On first run `install.bat` asks you to paste one
> (create it at https://github.com/settings/personal-access-tokens — fine-grained,
> only the `hf` repository, **Contents: Read** + **Metadata: Read**). The
> token is stored only on that PC in `%APPDATA%\HueForgeWeb\github_token.txt`
> and is used only for checking and downloading releases.
4. Next time, just use the shortcut or double-click **`start.bat`** —
   it opens the browser at `http://127.0.0.1:5173`
   (and self-heals dependencies if the folder was moved or `node_modules` deleted).

Close the black console window to stop the server. The installed version is
shown in the app's top bar next to the title.

## Versioning & releases

- Versioning is **semantic** (`vMAJOR.MINOR.PATCH`). The single source of truth
  is `version` in `package.json`; every release tag must match it, and the
  release workflow refuses tags that don't.
- Cutting a release: update `package.json` and `package-lock.json` to the same
  semantic version, commit them, then push the matching tag:

  ```bash
  VERSION=0.8.1   # replace with the version being released
  git tag "v$VERSION"
  git push origin main "v$VERSION"
  ```

  Pushing a `v*` tag triggers the **Release** workflow. It verifies the tag
  against `package.json`, runs typecheck, tests and the production build on
  Ubuntu, creates the source and deploy archives, and builds the Windows
  Electron installer on `windows-latest`. The workflow adds the installer,
  `latest.yml`, blockmap and both ZIP archives to a draft GitHub Release;
  publish the draft after reviewing the artifacts.
- `install.bat` compares your local version (from `package.json`) with the
  **latest GitHub release** on every run and offers to download and apply the
  update in place (`update.ps1` does the actual API calls). No need to
  re-download the zip for updates — unless a new `install.bat`/`start.bat`/
  `update.ps1` ships, in which case a fresh unzip applies those.

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

## Desktop app (Electron)

The same app ships as a native **HueForge Desktop** Windows app — a frameless window with custom title-bar controls, a taskbar
icon and a Start-menu shortcut, no browser or Node.js needed:

- **Install:** grab `hueforge-desktop-setup-<version>.exe` from the
  [Releases page](https://github.com/Sovero/hf/releases) and run it
  (NSIS installer, x64; you can pick the install folder).
- **Auto-update:** built in. The app checks GitHub Releases at startup
  (15 s after launch) and then every 4 hours; a small indicator appears in
  the top bar (⟳ checking, ↑ update available, % while downloading, ↓ ready
  to install — click it to act). Updates install on quit or immediately
  after a confirmation.
- **Private repository:** the update check needs a one-time GitHub token
  (fine-grained, `Contents: Read` + `Metadata: Read` on this repo — same
  token as `install.bat` uses). Click the update indicator, paste the token
  in the dialog, and it is stored encrypted on this PC (Electron
  safeStorage / DPAPI). `HF_GITHUB_TOKEN`-style env vars are not used by the
  desktop app.
- **Exports:** «Download STL/3MF/…» opens the native Windows "Save as…"
  dialog in the desktop app; in the browser build it downloads as before.

Build it from sources with `npm run dist` (needs `npm install` first); the
installer and its auto-update manifests (`latest.yml`, blockmap) land in
`release/` and are attached to GitHub Releases automatically by the release
workflow.

## Themes

Dark / Light / Nord / Solar — picker in the top bar, saved automatically.

## Development

```bash
npm install     # once
npm run dev     # dev server at http://127.0.0.1:5173
npm test        # 256 tests (31 test files)
npm run build   # production build to dist/
```

## Notes

- Everything runs **locally in the browser** — no server-side processing, images never leave the PC.
- Images are downscaled to 512 px on the long side before processing — this matches
  FDM resolution (≈0.3 mm cells at 150 mm width) and keeps files manageable.
- The mesh is watertight (verified by tests), so it slices cleanly.
