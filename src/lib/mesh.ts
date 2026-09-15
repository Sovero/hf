import type { HeightField, Mesh, PrintSettings, RGB } from './types'

const GRAY: RGB = { r: 128, g: 128, b: 128 }

/** Level index of empty space around the footprint (the bed, z = 0). */
const NO_LEVEL = -1

/** Colour slot of the neutral base plate (not a palette entry). */
const GRAY_SLOT = 255

/** Line kinds of the split map (see `lineKey`). */
const LX = 0
const LY = 1
const LZ = 2

/**
 * Fill one notch of every diagonal level contact.
 *
 * Where four cells meet at a grid corner with two *opposite* ones above the
 * other two, the four wall panels around that corner would share one vertical
 * edge — two lumps joined only along a line, a non-manifold pinch that slicers
 * flag. The reference mesher repairs the same situation in its per-layer masks
 * by filling one of the two empty cells; here the same rule runs over the
 * level sets: one of the lower cells is raised to the lower of the two tall
 * ones, a single 0.4 mm cell of difference that is below print resolution.
 * Raising a cell can expose a new contact next to it, so the pass repeats;
 * levels only ever rise, so it terminates.
 */
function repairDiagonalContacts(level: Int16Array, width: number, height: number): void {
  for (let pass = 0; pass < 16; pass++) {
    let changed = false
    for (let j = 0; j + 1 < height; j++) {
      const row = j * width
      for (let i = 0; i + 1 < width; i++) {
        const a = row + i
        const b = a + 1
        const c = a + width
        const d = c + 1
        const diagonalAD = Math.min(level[a], level[d])
        const diagonalBC = Math.min(level[b], level[c])
        if (diagonalAD > Math.max(level[b], level[c])) {
          level[b] = diagonalAD
          changed = true
        } else if (diagonalBC > Math.max(level[a], level[d])) {
          level[a] = diagonalBC
          changed = true
        }
      }
    }
    if (!changed) return
  }
}

/**
 * Build the HueForge-style stepped relief as one closed solid, as large
 * rectangles instead of one quad per cell.
 *
 * Surface model (the reference Standard-mode mesher):
 * - every cell is a flat plateau at its own layer height, so the print shows
 *   real tonal steps of one layer (~0.2 mm) instead of a pile of color bands;
 * - where two cells differ in height, the exposed material is a vertical wall
 *   panel spanning exactly that difference (the "curtain" between levels);
 * - the bottom is the flat base plate at z = 0, and the outer border gets the
 *   same wall treatment (outside is the bed, z = 0).
 *
 * Merging: runs of cells with equal height *and* equal paint become one
 * rectangle (greedy row scan), and consecutive grid segments whose two levels
 * and paint agree become one wall panel. A plateau can therefore cover
 * thousands of cells with a handful of triangles.
 *
 * Closed without T-junctions: merging saves triangles only if the pieces can
 * be stitched, and a rectangle's edge cut in one place while its neighbour
 * stays uncut is exactly the T-junction that opens a mesh. So every shared
 * edge line gets a *split map*: the set of positions where any face touching
 * that line ends. Each face then puts a vertex at every position of that set
 * inside its own extent — its corners, its neighbour's corners, and the ends of
 * every wall panel it faces. Two faces that share an edge therefore split it
 * identically, by construction, whatever the merge pattern turned out to be.
 * Every edge is then shared by exactly two triangles, which the mesh tests pin.
 *
 * Triangulation: each face is a convex rectangle, so ear clipping emits
 * exactly P − 2 triangles for its P perimeter vertices, none degenerate (a
 * fully split cell costs the same two triangles a per-cell quad would).
 *
 * Geometry: X spans `settings.widthMm`, Y spans `settings.heightMm`, Z is the
 * print direction (up). 1 unit = 1 mm.
 *
 * Orientation: row 0 of the input image is the *top* of the photo. It is
 * mirrored to the far (max-Y) edge so the printed face reads like the picture
 * when it lies flat on the bed.
 */
export function buildMesh(
  field: HeightField,
  cellColors: Uint8Array,
  palette: RGB[],
  settings: PrintSettings,
): Mesh {
  const W = Math.max(1, field.width)
  const H = Math.max(1, field.height)
  const dx = settings.widthMm / W
  const dy = settings.heightMm / H
  const baseMm = settings.baseMm
  const layerMm = settings.layerMm > 0 ? settings.layerMm : 0.2

  // ---- 1. Mirror the photo (row 0 → max Y) and resolve every cell height to
  // a whole layer index. Integer levels make "same height" exact, so plateau
  // corners and wall panels meet vertex-for-vertex instead of nearly.
  const level = new Int16Array(W * H)
  const cellColor = new Uint8Array(W * H)
  for (let r = 0; r < H; r++) {
    const srcRow = r * W
    const dstRow = (H - 1 - r) * W
    for (let c = 0; c < W; c++) {
      const z = field.values[srcRow + c]
      let k = Number.isFinite(z) ? Math.round((z - baseMm) / layerMm) : 0
      // The pipeline clamps a column to maxHeightMm; when that cap is off the
      // layer grid, rounding lands above it — step back so the configured
      // total height stays an upper bound of the geometry.
      if (baseMm + k * layerMm > settings.maxHeightMm + 1e-9) k--
      level[dstRow + c] = k < 0 ? 0 : k
      cellColor[dstRow + c] = cellColors[srcRow + c]
    }
  }

  // ---- 2. Remove diagonal level contacts (see the helper).
  repairDiagonalContacts(level, W, H)

  let maxLevel = 0
  for (let n = 0; n < level.length; n++) if (level[n] > maxLevel) maxLevel = level[n]

  const levelAt = (i: number, j: number) => (i >= 0 && j >= 0 && i < W && j < H ? level[j * W + i] : NO_LEVEL)
  const slotAt = (i: number, j: number) => (i >= 0 && j >= 0 && i < W && j < H ? cellColor[j * W + i] : GRAY_SLOT)
  /** Height of a level index; empty space sits on the bed at z = 0. */
  const zOfLevel = (k: number) => (k < 0 ? 0 : baseMm + k * layerMm)

  // ---- 3. Top surface: maximal rectangles of equal (level, paint).
  const rectI: number[] = []
  const rectJ: number[] = []
  const rectW: number[] = []
  const rectH: number[] = []
  const rectK: number[] = []
  const rectSlot: number[] = []
  const used = new Uint8Array(W * H)
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const at = j * W + i
      if (used[at] !== 0) continue
      const k = level[at]
      const slot = cellColor[at]
      let w = 1
      while (i + w < W && used[at + w] === 0 && level[at + w] === k && cellColor[at + w] === slot) w++
      let h = 1
      grow: while (j + h < H) {
        const row = (j + h) * W
        for (let x = 0; x < w; x++) {
          const q = row + i + x
          if (used[q] !== 0 || level[q] !== k || cellColor[q] !== slot) break grow
        }
        h++
      }
      for (let y = 0; y < h; y++) {
        const row = (j + y) * W
        for (let x = 0; x < w; x++) used[row + i + x] = 1
      }
      rectI.push(i)
      rectJ.push(j)
      rectW.push(w)
      rectH.push(h)
      rectK.push(k)
      rectSlot.push(slot)
    }
  }
  const rectCount = rectI.length

  // ---- 4. Wall panels: maximal runs of one grid line with the same pair of
  // levels and the same paint (the taller column's filament). Geometry is
  // identical to one panel per grid segment, just welded.
  // axis 0: panel in the plane x = line·dx, covering rows [t0, t1)
  // axis 1: panel in the plane y = line·dy, covering columns [t0, t1)
  const runAxis: number[] = []
  const runLine: number[] = []
  const runT0: number[] = []
  const runT1: number[] = []
  const runLo: number[] = []
  const runHi: number[] = []
  const runSlot: number[] = []
  const runSign: number[] = []
  const pushRun = (axis: 0 | 1, line: number, t0: number, t1: number, kA: number, kB: number, slot: number) => {
    runAxis.push(axis)
    runLine.push(line)
    runT0.push(t0)
    runT1.push(t1)
    runLo.push(Math.min(kA, kB))
    runHi.push(Math.max(kA, kB))
    runSlot.push(slot)
    // Which way the exposed material faces: the taller of the two columns.
    runSign.push(kA > kB ? 1 : -1)
  }
  for (let line = 0; line <= W; line++) {
    let t0 = -1
    let kA = 0
    let kB = 0
    let slot = 0
    for (let j = 0; j <= H; j++) {
      let has = false
      let a = 0
      let b = 0
      let s = 0
      if (j < H) {
        a = levelAt(line - 1, j)
        b = levelAt(line, j)
        if (a !== b) {
          has = true
          s = a > b ? slotAt(line - 1, j) : slotAt(line, j)
        }
      }
      if (has && t0 >= 0 && a === kA && b === kB && s === slot) continue
      if (t0 >= 0) pushRun(0, line, t0, j, kA, kB, slot)
      if (has) {
        t0 = j
        kA = a
        kB = b
        slot = s
      } else {
        t0 = -1
      }
    }
  }
  for (let line = 0; line <= H; line++) {
    let t0 = -1
    let kA = 0
    let kB = 0
    let slot = 0
    for (let i = 0; i <= W; i++) {
      let has = false
      let a = 0
      let b = 0
      let s = 0
      if (i < W) {
        a = levelAt(i, line - 1)
        b = levelAt(i, line)
        if (a !== b) {
          has = true
          s = a > b ? slotAt(i, line - 1) : slotAt(i, line)
        }
      }
      if (has && t0 >= 0 && a === kA && b === kB && s === slot) continue
      if (t0 >= 0) pushRun(1, line, t0, i, kA, kB, slot)
      if (has) {
        t0 = i
        kA = a
        kB = b
        slot = s
      } else {
        t0 = -1
      }
    }
  }
  const runCount = runAxis.length

  // ---- 5. Split map: for every edge line, the positions where a face that
  // touches it ends. kind 0 = line y = a·dy at z = z_b (runs along X, positions
  // in x units); kind 1 = line x = a·dx at z = z_b (runs along Y, positions in
  // y units); kind 2 = vertical line at grid vertex (a, b) (positions in level
  // units, b stores the level index + 1 so the bed level −1 fits).
  const stride = Math.max(W, H, maxLevel + 2) + 4
  const lineKey = (kind: number, a: number, b: number) => (kind * stride + a) * stride + (b + 1)
  const linePos = new Map<number, number[]>()
  const addPos = (kind: number, a: number, b: number, p: number) => {
    const key = lineKey(kind, a, b)
    const arr = linePos.get(key)
    if (arr === undefined) linePos.set(key, [p])
    else arr.push(p)
  }

  for (let r = 0; r < rectCount; r++) {
    const i0 = rectI[r]
    const j0 = rectJ[r]
    const i1 = i0 + rectW[r]
    const j1 = j0 + rectH[r]
    const k = rectK[r]
    addPos(LX, j0, k, i0)
    addPos(LX, j0, k, i1)
    addPos(LX, j1, k, i0)
    addPos(LX, j1, k, i1)
    addPos(LY, i0, k, j0)
    addPos(LY, i0, k, j1)
    addPos(LY, i1, k, j0)
    addPos(LY, i1, k, j1)
  }
  for (let r = 0; r < runCount; r++) {
    const line = runLine[r]
    const t0 = runT0[r]
    const t1 = runT1[r]
    const lo = runLo[r]
    const hi = runHi[r]
    if (runAxis[r] === 0) {
      addPos(LY, line, lo, t0)
      addPos(LY, line, lo, t1)
      addPos(LY, line, hi, t0)
      addPos(LY, line, hi, t1)
      addPos(LZ, line, t0, lo)
      addPos(LZ, line, t0, hi)
      addPos(LZ, line, t1, lo)
      addPos(LZ, line, t1, hi)
    } else {
      addPos(LX, line, lo, t0)
      addPos(LX, line, lo, t1)
      addPos(LX, line, hi, t0)
      addPos(LX, line, hi, t1)
      addPos(LZ, t0, line, lo)
      addPos(LZ, t0, line, hi)
      addPos(LZ, t1, line, lo)
      addPos(LZ, t1, line, hi)
    }
  }
  // Base plate corners (the plate is one face at the bed level).
  addPos(LX, 0, NO_LEVEL, 0)
  addPos(LX, 0, NO_LEVEL, W)
  addPos(LX, H, NO_LEVEL, 0)
  addPos(LX, H, NO_LEVEL, W)
  addPos(LY, 0, NO_LEVEL, 0)
  addPos(LY, 0, NO_LEVEL, H)
  addPos(LY, W, NO_LEVEL, 0)
  addPos(LY, W, NO_LEVEL, H)

  for (const arr of linePos.values()) {
    arr.sort((a, b) => a - b)
    let w = 1
    for (let m = 1; m < arr.length; m++) if (arr[m] !== arr[w - 1]) arr[w++] = arr[m]
    arr.length = w
  }

  const tmp: number[] = []
  /**
   * First index of a sorted line whose position is greater than `value`.
   * A long border line can carry one split per cell, and faces sit all along
   * it — scanning from the start would make the whole walk quadratic.
   */
  const firstAbove = (arr: number[], value: number) => {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid] <= value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  /** Interior split positions of a line, strictly between `from` and `to`. */
  const collect = (key: number, from: number, to: number) => {
    tmp.length = 0
    const arr = linePos.get(key)
    if (arr === undefined) return
    for (let m = firstAbove(arr, from); m < arr.length && arr[m] < to; m++) tmp.push(arr[m])
  }

  // Face frames. mode 0: flat top/base, u = column (x), v = row (y).
  // mode 1: panel in an x-plane, u = row (y), v = level (z).
  // mode 2: panel in a y-plane, u = column (x), v = level (z).
  // `line` is the panel's grid line (unused for mode 0), `level` the flat
  // face's level (unused for panels).
  const lineUKey = (mode: number, line: number, v: number, level: number) =>
    mode === 0 ? lineKey(LX, v, level) : mode === 1 ? lineKey(LY, line, v) : lineKey(LX, line, v)
  const lineVKey = (mode: number, line: number, u: number, level: number) =>
    mode === 0 ? lineKey(LY, u, level) : mode === 1 ? lineKey(LZ, line, u) : lineKey(LZ, u, line)

  // ---- 6. Emit. Every face is at least two triangles (P ≥ 4), so the face
  // count bounds the buffers from below and they grow by doubling from there;
  // the exact size is trimmed at the end.
  let positions = new Float32Array(Math.max(64, (rectCount + runCount + 1) * 2) * 9)
  let colors = new Float32Array(positions.length)
  let v = 0

  const vertex = (x: number, y: number, z: number, c: RGB) => {
    if (v === positions.length) {
      const grown = new Float32Array(positions.length * 2)
      grown.set(positions)
      positions = grown
      const grownColors = new Float32Array(grown.length)
      grownColors.set(colors)
      colors = grownColors
    }
    positions[v] = x
    positions[v + 1] = y
    positions[v + 2] = z
    colors[v] = c.r / 255
    colors[v + 1] = c.g / 255
    colors[v + 2] = c.b / 255
    v += 3
  }
  /** Triangle whose normal points toward (nx, ny, nz). */
  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    c: RGB, nx: number, ny: number, nz: number,
  ) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const wx = cx - ax, wy = cy - ay, wz = cz - az
    const sx = uy * wz - uz * wy
    const sy = uz * wx - ux * wz
    const sz = ux * wy - uy * wx
    vertex(ax, ay, az, c)
    if (sx * nx + sy * ny + sz * nz < 0) {
      vertex(cx, cy, cz, c)
      vertex(bx, by, bz, c)
    } else {
      vertex(bx, by, bz, c)
      vertex(cx, cy, cz, c)
    }
  }

  const poly: number[] = []
  const order: number[] = []
  const slotColor = (slot: number): RGB => (slot === GRAY_SLOT ? GRAY : palette[slot] ?? GRAY)

  /**
   * Perimeter of one face, in its local (u, v) frame, with a vertex wherever
   * another face's edge ends on a side (the split map) — corners first, then
   * each side's interior splits, walking the rectangle counter-clockwise.
   */
  const buildPerimeter = (mode: number, line: number, u0: number, u1: number, v0: number, v1: number, level: number) => {
    poly.length = 0
    const z = mode === 0 ? zOfLevel(level) : 0
    const put = (u: number, w: number) => {
      if (mode === 0) poly.push(u * dx, w * dy, z)
      else if (mode === 1) poly.push(line * dx, u * dy, zOfLevel(w))
      else poly.push(u * dx, line * dy, zOfLevel(w))
    }
    collect(lineUKey(mode, line, v0, level), u0, u1)
    put(u0, v0)
    for (let m = 0; m < tmp.length; m++) put(tmp[m], v0)
    put(u1, v0)
    collect(lineVKey(mode, line, u1, level), v0, v1)
    for (let m = 0; m < tmp.length; m++) put(u1, tmp[m])
    put(u1, v1)
    collect(lineUKey(mode, line, v1, level), u0, u1)
    for (let m = tmp.length - 1; m >= 0; m--) put(tmp[m], v1)
    put(u0, v1)
    collect(lineVKey(mode, line, u0, level), v0, v1)
    for (let m = tmp.length - 1; m >= 0; m--) put(u0, tmp[m])
  }

  /**
   * Emit the current perimeter as triangles: ear clipping in the face's own
   * plane. An ear is only valid when it is non-degenerate *and* its triangle
   * holds no other polygon vertex — dropping the empty-triangle test strands
   * the boundary: clipping an ear across a straight run leaves those vertices
   * on no triangle at all, which reads as an open edge. Yields exactly P − 2
   * triangles, none degenerate, all P perimeter vertices used.
   */
  const emitFace = (proj: 0 | 1 | 2, color: RGB, nx: number, ny: number, nz: number) => {
    const n = poly.length / 3
    order.length = 0
    for (let m = 0; m < n; m++) order.push(m)
    const k0 = proj === 0 ? 0 : proj === 1 ? 1 : 0
    const k1 = proj === 0 ? 1 : 2
    while (order.length > 3) {
      let clipped = false
      for (let m = 0; m < order.length; m++) {
        const a = order[(m + order.length - 1) % order.length]
        const b = order[m]
        const c = order[(m + 1) % order.length]
        const au = poly[a * 3 + k0]
        const av = poly[a * 3 + k1]
        const bu = poly[b * 3 + k0]
        const bv = poly[b * 3 + k1]
        const cu = poly[c * 3 + k0]
        const cv = poly[c * 3 + k1]
        const area2 = (bu - au) * (cv - av) - (bv - av) * (cu - au)
        if (area2 === 0) continue
        // Blocked when another vertex still on the polygon lies inside the
        // ear or exactly on one of its edges (a collinear run).
        const minU = Math.min(au, bu, cu)
        const maxU = Math.max(au, bu, cu)
        const minV = Math.min(av, bv, cv)
        const maxV = Math.max(av, bv, cv)
        let blocked = false
        for (let d = 0; d < order.length; d++) {
          const e = order[d]
          if (e === a || e === b || e === c) continue
          const du = poly[e * 3 + k0]
          const dv = poly[e * 3 + k1]
          if (du < minU || du > maxU || dv < minV || dv > maxV) continue
          const s1 = (bu - au) * (dv - av) - (bv - av) * (du - au)
          const s2 = (cu - bu) * (dv - bv) - (cv - bv) * (du - bu)
          const s3 = (au - cu) * (dv - cv) - (av - cv) * (du - cu)
          if (area2 > 0 ? s1 >= 0 && s2 >= 0 && s3 >= 0 : s1 <= 0 && s2 <= 0 && s3 <= 0) {
            blocked = true
            break
          }
        }
        if (blocked) continue
        tri(
          poly[a * 3], poly[a * 3 + 1], poly[a * 3 + 2],
          poly[b * 3], poly[b * 3 + 1], poly[b * 3 + 2],
          poly[c * 3], poly[c * 3 + 1], poly[c * 3 + 2],
          color, nx, ny, nz,
        )
        order.splice(m, 1)
        clipped = true
        break
      }
      if (!clipped) return
    }
    if (order.length === 3) {
      const a = order[0]
      const b = order[1]
      const c = order[2]
      tri(
        poly[a * 3], poly[a * 3 + 1], poly[a * 3 + 2],
        poly[b * 3], poly[b * 3 + 1], poly[b * 3 + 2],
        poly[c * 3], poly[c * 3 + 1], poly[c * 3 + 2],
        color, nx, ny, nz,
      )
    }
  }

  // Plateau rectangles: flat at the rectangle's layer height, painted with the
  // filament that ends there. A one-cell rectangle is always four vertices —
  // split positions are whole grid units, so a one-cell side cannot hold one —
  // and a scattered image is mostly one-cell rectangles, so it gets a quad
  // straight away instead of a perimeter walk.
  for (let r = 0; r < rectCount; r++) {
    const i0 = rectI[r]
    const j0 = rectJ[r]
    const w = rectW[r]
    const h = rectH[r]
    const k = rectK[r]
    const color = slotColor(rectSlot[r])
    const z = zOfLevel(k)
    const x0 = i0 * dx
    const x1 = (i0 + w) * dx
    const y0 = j0 * dy
    const y1 = (j0 + h) * dy
    if (w === 1 && h === 1) {
      tri(x0, y0, z, x0, y1, z, x1, y1, z, color, 0, 0, 1)
      tri(x0, y0, z, x1, y1, z, x1, y0, z, color, 0, 0, 1)
      continue
    }
    buildPerimeter(0, 0, i0, i0 + w, j0, j0 + h, k)
    emitFace(0, color, 0, 0, 1)
  }

  // Walls along the vertical grid lines: the step between neighbouring columns
  // and the footprint's left/right border (outside = the bed).
  for (let r = 0; r < runCount; r++) {
    if (runAxis[r] !== 0) continue
    const color = slotColor(runSlot[r])
    const u0 = runT0[r]
    const u1 = runT1[r]
    const z0 = zOfLevel(runLo[r])
    const z1 = zOfLevel(runHi[r])
    if (u1 - u0 === 1 && runHi[r] - runLo[r] === 1) {
      const x = runLine[r] * dx
      const y0 = u0 * dy
      const y1 = u1 * dy
      tri(x, y0, z0, x, y1, z0, x, y1, z1, color, runSign[r], 0, 0)
      tri(x, y0, z0, x, y1, z1, x, y0, z1, color, runSign[r], 0, 0)
      continue
    }
    buildPerimeter(1, runLine[r], u0, u1, runLo[r], runHi[r], 0)
    emitFace(1, color, runSign[r], 0, 0)
  }

  // Walls along the horizontal grid lines: the step between neighbouring rows
  // and the footprint's near/far border.
  for (let r = 0; r < runCount; r++) {
    if (runAxis[r] !== 1) continue
    const color = slotColor(runSlot[r])
    const u0 = runT0[r]
    const u1 = runT1[r]
    const z0 = zOfLevel(runLo[r])
    const z1 = zOfLevel(runHi[r])
    if (u1 - u0 === 1 && runHi[r] - runLo[r] === 1) {
      const y = runLine[r] * dy
      const x0 = u0 * dx
      const x1 = u1 * dx
      tri(x0, y, z0, x1, y, z0, x1, y, z1, color, 0, runSign[r], 0)
      tri(x0, y, z0, x1, y, z1, x0, y, z1, color, 0, runSign[r], 0)
      continue
    }
    buildPerimeter(2, runLine[r], u0, u1, runLo[r], runHi[r], 0)
    emitFace(2, color, 0, runSign[r], 0)
  }

  // Base plate: the model's bottom face at z = 0.
  buildPerimeter(0, 0, 0, W, 0, H, NO_LEVEL)
  emitFace(0, GRAY, 0, 0, -1)

  // Trim to what was written: everything downstream (viewer, STL, 3MF) reads
  // the buffers whole, so no slack may stay behind.
  const triangleCount = v / 9
  return {
    positions: positions.length === v ? positions : positions.slice(0, v),
    colors: colors.length === v ? colors : colors.slice(0, v),
    triangleCount,
  }
}
