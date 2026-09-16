import type { HeightField, Mesh, PrintSettings, RGB } from './types'

const GRAY: RGB = { r: 128, g: 128, b: 128 }

/** Colour slot of the neutral base plate (not a palette entry). */
const GRAY_SLOT = 255

/**
 * Build the relief as one closed solid whose top surface is a *height map*.
 *
 * Surface model (the reference Standard-mode mesher, `match_Front`):
 * - the relief lives on a vertex grid — one shared vertex per grid line
 *   crossing, so four cells meet at a corner and a height change between
 *   neighbours becomes a *diagonal* face, not a vertical step. A tonal ramp
 *   therefore prints as a continuous slope, and the number of distinct heights
 *   is exactly the number of print layers the picture uses;
 * - a vertex carries the height of the pixel it belongs to (the cell to its
 *   lower left, with the far row and column repeating the last pixel). Every
 *   pixel's height therefore appears in the surface exactly once: a one-cell
 *   dark line stays a groove, a one-cell bright ridge stays a crest, and no
 *   feature is bridged or flattened away. Heights stay on the print-layer
 *   ladder (no invented half-layers, no averaging), and a flat area keeps its
 *   exact extent — its plateau spans precisely its own cells, with the single
 *   sloped cell attaching on the side the picture steps down to;
 * - vertical faces exist only on the outer contour: the four side walls drop
 *   from the border heights to the bed (z = 0), and the bottom is the flat base
 *   plate. There is no interior wall, so the surface is a single-valued sheet
 *   and the solid can never pinch along an edge.
 *
 * The mesh is closed by construction: the top grid shares the border vertices
 * with the side walls, the walls are split per grid cell, and the base plate's
 * perimeter carries a vertex at every one of those cell ends. Every edge is
 * shared by exactly two triangles, which the mesh tests pin.
 *
 * Triangulation: each top cell is split by a fixed diagonal (two triangles),
 * so no vertex is ever left stranded and no T-junction can appear; the base
 * plate is ear-clipped along its perimeter (P − 2 triangles, none degenerate).
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
  // a whole layer index. Integer levels make "same height" exact, so the
  // shared vertices meet vertex-for-vertex instead of nearly.
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

  const zOfLevel = (k: number) => baseMm + k * layerMm

  // ---- 2. Vertex grid: (W + 1) × (H + 1) heights sampled from the cell grid.
  // A vertex takes the pixel it belongs to, so the surface is the picture's own
  // height map and nothing is averaged away; the far row and column repeat the
  // last pixel, which is what makes the border heights match the border cells.
  const vw = W + 1
  const vh = H + 1
  const vlevel = new Int16Array(vw * vh)
  for (let j = 0; j < vh; j++) {
    const row = Math.min(j, H - 1) * W
    for (let i = 0; i < vw; i++) {
      vlevel[j * vw + i] = level[row + Math.min(i, W - 1)]
    }
  }
  const zAt = (i: number, j: number) => zOfLevel(vlevel[j * vw + i])

  // ---- 3. Buffers, sized exactly: two top triangles per cell, two per border
  // cell, and the ear-clipped base plate.
  const topTris = 2 * W * H
  const wallTris = 4 * (W + H)
  const bottomTris = 2 * (W + H) - 2
  const positions = new Float32Array((topTris + wallTris + bottomTris) * 9)
  const colors = new Float32Array(positions.length)
  let v = 0

  const vertex = (x: number, y: number, z: number, c: RGB) => {
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

  const slotColor = (slot: number): RGB => (slot === GRAY_SLOT ? GRAY : palette[slot] ?? GRAY)

  // ---- 4. Top surface: the height map itself. Every cell keeps its filament
  // color, and the shared grid means a slanted face belongs to the cell whose
  // pixel it covers, so the slicer sees the same color regions as the preview.
  for (let j = 0; j < H; j++) {
    const y0 = j * dy
    const y1 = (j + 1) * dy
    for (let i = 0; i < W; i++) {
      const c = slotColor(cellColor[j * W + i])
      const x0 = i * dx
      const x1 = (i + 1) * dx
      const z00 = zAt(i, j)
      const z10 = zAt(i + 1, j)
      const z11 = zAt(i + 1, j + 1)
      const z01 = zAt(i, j + 1)
      tri(x0, y0, z00, x1, y0, z10, x1, y1, z11, c, 0, 0, 1)
      tri(x0, y0, z00, x1, y1, z11, x0, y1, z01, c, 0, 0, 1)
    }
  }

  // ---- 5. Outer contour walls: from the bed (z = 0) up to the border heights.
  // The wall's top edge is the surface's own border edge — slanted with it —
  // and its bottom edge is one grid cell, matching the base plate's perimeter.
  for (let j = 0; j < H; j++) {
    const y0 = j * dy
    const y1 = (j + 1) * dy
    const za = zAt(0, j)
    const zb = zAt(0, j + 1)
    tri(0, y0, 0, 0, y1, 0, 0, y1, zb, slotColor(cellColor[j * W]), -1, 0, 0)
    tri(0, y0, 0, 0, y1, zb, 0, y0, za, slotColor(cellColor[j * W]), -1, 0, 0)

    const xr = W * dx
    const zc = zAt(W, j)
    const zd = zAt(W, j + 1)
    tri(xr, y0, 0, xr, y1, 0, xr, y1, zd, slotColor(cellColor[j * W + W - 1]), 1, 0, 0)
    tri(xr, y0, 0, xr, y1, zd, xr, y0, zc, slotColor(cellColor[j * W + W - 1]), 1, 0, 0)
  }
  for (let i = 0; i < W; i++) {
    const x0 = i * dx
    const x1 = (i + 1) * dx
    const za = zAt(i, 0)
    const zb = zAt(i + 1, 0)
    tri(x0, 0, 0, x1, 0, 0, x1, 0, zb, slotColor(cellColor[i]), 0, -1, 0)
    tri(x0, 0, 0, x1, 0, zb, x0, 0, za, slotColor(cellColor[i]), 0, -1, 0)

    const yf = H * dy
    const zc = zAt(i, H)
    const zd = zAt(i + 1, H)
    tri(x0, yf, 0, x1, yf, 0, x1, yf, zd, slotColor(cellColor[(H - 1) * W + i]), 0, 1, 0)
    tri(x0, yf, 0, x1, yf, zd, x0, yf, zc, slotColor(cellColor[(H - 1) * W + i]), 0, 1, 0)
  }

  // ---- 6. Base plate: the flat bottom at z = 0. Its perimeter carries a
  // vertex at every wall cell end, so the walls stitch to it edge for edge.
  const poly: number[] = []
  const push = (i: number, j: number) => poly.push(i * dx, j * dy, 0)
  push(0, 0)
  for (let i = 1; i <= W; i++) push(i, 0)
  for (let j = 1; j <= H; j++) push(W, j)
  for (let i = W - 1; i >= 0; i--) push(i, H)
  for (let j = H - 1; j >= 1; j--) push(0, j)

  /**
   * Ear clipping in the base plate's own plane. An ear is only valid when it is
   * non-degenerate *and* holds no other polygon vertex — dropping the
   * empty-ear test strands the collinear perimeter vertices on no triangle at
   * all, which reads as an open edge. Yields exactly P − 2 triangles, all of
   * them real.
   */
  const emitBasePlate = () => {
    const order: number[] = []
    const n = poly.length / 3
    for (let m = 0; m < n; m++) order.push(m)
    while (order.length > 3) {
      let clipped = false
      for (let m = 0; m < order.length; m++) {
        const a = order[(m + order.length - 1) % order.length]
        const b = order[m]
        const c = order[(m + 1) % order.length]
        const au = poly[a * 3]
        const av = poly[a * 3 + 1]
        const bu = poly[b * 3]
        const bv = poly[b * 3 + 1]
        const cu = poly[c * 3]
        const cv = poly[c * 3 + 1]
        const area2 = (bu - au) * (cv - av) - (bv - av) * (cu - au)
        if (area2 === 0) continue
        const minU = Math.min(au, bu, cu)
        const maxU = Math.max(au, bu, cu)
        const minV = Math.min(av, bv, cv)
        const maxV = Math.max(av, bv, cv)
        let blocked = false
        for (let d = 0; d < order.length; d++) {
          const e = order[d]
          if (e === a || e === b || e === c) continue
          const du = poly[e * 3]
          const dv = poly[e * 3 + 1]
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
          poly[a * 3], poly[a * 3 + 1], 0,
          poly[b * 3], poly[b * 3 + 1], 0,
          poly[c * 3], poly[c * 3 + 1], 0,
          GRAY, 0, 0, -1,
        )
        order.splice(m, 1)
        clipped = true
        break
      }
      if (!clipped) break
    }
    if (order.length === 3) {
      const a = order[0]
      const b = order[1]
      const c = order[2]
      tri(
        poly[a * 3], poly[a * 3 + 1], 0,
        poly[b * 3], poly[b * 3 + 1], 0,
        poly[c * 3], poly[c * 3 + 1], 0,
        GRAY, 0, 0, -1,
      )
    }
  }
  emitBasePlate()

  // Trim to what was written: everything downstream (viewer, STL, 3MF) reads
  // the buffers whole, so no slack may stay behind.
  const triangleCount = v / 9
  return {
    positions: positions.length === v ? positions : positions.slice(0, v),
    colors: colors.length === v ? colors : colors.slice(0, v),
    triangleCount,
  }
}
