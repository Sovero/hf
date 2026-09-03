import type { HeightField, Mesh, PrintSettings, RGB } from './types'

const GRAY: RGB = { r: 128, g: 128, b: 128 }

type Pt3 = [number, number, number]

/**
 * Build a solid mesh for the stepped relief:
 * - one top quad per cell at its height, colored by the cell's palette color
 * - vertical walls only where adjacent cells differ in height, colored by the
 *   taller cell's color; boundary walls use their own cell's color
 * - a gray bottom grid at z = 0
 *
 * Watertightness: every wall's vertical edge is subdivided at the heights of
 * all cells touching its end corners, so walls meeting at a grid corner share
 * exactly matching edge segments. Where four walls of an "X pattern" corner
 * overlap in Z, an edge is legitimately shared by four triangles (closed but
 * non-manifold line — standard for heightmap meshes, handled by slicers).
 *
 * Geometry: X spans `settings.widthMm`, Y spans `settings.heightMm`,
 * Z is the print direction (up). 1 unit = 1 mm.
 */
export function buildMesh(
  field: HeightField,
  cellColors: Uint8Array,
  palette: RGB[],
  settings: PrintSettings,
): Mesh {
  const { width: W, height: H } = field
  const dx = settings.widthMm / W
  const dy = settings.heightMm / H

  const positions: number[] = []
  const colors: number[] = []

  const heightAt = (i: number, j: number): number | null =>
    i >= 0 && j >= 0 && i < W && j < H ? field.values[j * W + i] : null

  const colorAt = (i: number, j: number): RGB =>
    i >= 0 && j >= 0 && i < W && j < H ? (palette[cellColors[j * W + i]] ?? GRAY) : GRAY

  /** Emit one triangle, oriented so its normal points toward (nx, ny, nz). */
  const pushTri = (a: Pt3, b: Pt3, c: Pt3, color: RGB, nx: number, ny: number, nz: number) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    let B = b
    let C = c
    if (cx * nx + cy * ny + cz * nz < 0) {
      B = c
      C = b
    }
    for (const p of [a, B, C]) {
      positions.push(p[0], p[1], p[2])
      colors.push(color.r / 255, color.g / 255, color.b / 255)
    }
  }

  const pushQuad = (a: Pt3, b: Pt3, c: Pt3, d: Pt3, color: RGB, nx: number, ny: number, nz: number) => {
    pushTri(a, b, c, color, nx, ny, nz)
    pushTri(a, c, d, color, nx, ny, nz)
  }

  // ---- Top faces (normal +Z) ----
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const z = field.values[j * W + i]
      pushQuad(
        [i * dx, j * dy, z],
        [(i + 1) * dx, j * dy, z],
        [(i + 1) * dx, (j + 1) * dy, z],
        [i * dx, (j + 1) * dy, z],
        colorAt(i, j), 0, 0, 1,
      )
    }
  }

  // ---- Walls ----

  /** Heights of all cells touching grid corner (ci, cj), plus 0. */
  const cornerHeights = (ci: number, cj: number): number[] => {
    const s = new Set<number>([0])
    for (const [i, j] of [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]]) {
      const z = heightAt(i, j)
      if (z !== null) s.add(z)
    }
    return [...s]
  }

  /**
   * Break z-values for one end of a wall: all corner-cell heights clamped to
   * the wall's [zLo, zHi] range, sorted and deduplicated.
   */
  const endBreaks = (ci: number, cj: number, zLo: number, zHi: number): number[] => {
    const zs = cornerHeights(ci, cj).filter((z) => z >= zLo && z <= zHi)
    zs.push(zLo, zHi)
    return [...new Set(zs)].sort((a, b) => a - b)
  }

  /**
   * Vertical wall between points (x0,y0) and (x1,y1) (sharing x or y).
   * Emitted as a triangle strip "zipper" between the two end polylines so
   * both ends carry exactly their own break vertices.
   */
  const emitWall = (
    x0: number, y0: number,
    x1: number, y1: number,
    b1: number[], b2: number[],
    nx: number, ny: number,
    color: RGB,
  ) => {
    const P: Pt3[] = b1.map((z) => [x0, y0, z])
    const Q: Pt3[] = b2.map((z) => [x1, y1, z])
    let ii = 0
    let jj = 0
    for (;;) {
      const pz = ii < P.length - 1 ? P[ii + 1][2] : Infinity
      const qz = jj < Q.length - 1 ? Q[jj + 1][2] : Infinity
      if (pz === Infinity && qz === Infinity) break
      if (pz <= qz) {
        pushTri(P[ii], Q[jj], P[ii + 1], color, nx, ny, 0)
        ii++
      } else {
        pushTri(P[ii], Q[jj], Q[jj + 1], color, nx, ny, 0)
        jj++
      }
    }
  }

  // Interior walls along x = i·dx (between cells (i-1,j) and (i,j)).
  for (let i = 1; i < W; i++) {
    for (let j = 0; j < H; j++) {
      const hL = heightAt(i - 1, j)!
      const hR = heightAt(i, j)!
      if (hL === hR) continue
      const zLo = Math.min(hL, hR)
      const zHi = Math.max(hL, hR)
      const tallRight = hR > hL
      emitWall(
        i * dx, j * dy, i * dx, (j + 1) * dy,
        endBreaks(i, j, zLo, zHi),
        endBreaks(i, j + 1, zLo, zHi),
        tallRight ? -1 : 1, 0,
        colorAt(tallRight ? i : i - 1, j),
      )
    }
  }

  // Interior walls along y = j·dy (between cells (i,j-1) and (i,j)).
  for (let j = 1; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const hT = heightAt(i, j - 1)!
      const hB = heightAt(i, j)!
      if (hT === hB) continue
      const zLo = Math.min(hT, hB)
      const zHi = Math.max(hT, hB)
      const tallBelow = hB > hT // j+1 side (larger y) is taller
      emitWall(
        i * dx, j * dy, (i + 1) * dx, j * dy,
        endBreaks(i, j, zLo, zHi),
        endBreaks(i + 1, j, zLo, zHi),
        0, tallBelow ? -1 : 1,
        colorAt(i, tallBelow ? j : j - 1),
      )
    }
  }

  // Boundary walls.
  for (let j = 0; j < H; j++) {
    const hl = heightAt(0, j)!
    emitWall(0, j * dy, 0, (j + 1) * dy,
      endBreaks(0, j, 0, hl), endBreaks(0, j + 1, 0, hl), -1, 0, colorAt(0, j))

    const hr = heightAt(W - 1, j)!
    emitWall(W * dx, j * dy, W * dx, (j + 1) * dy,
      endBreaks(W, j, 0, hr), endBreaks(W, j + 1, 0, hr), 1, 0, colorAt(W - 1, j))
  }
  for (let i = 0; i < W; i++) {
    const hb = heightAt(i, 0)!
    emitWall(i * dx, 0, (i + 1) * dx, 0,
      endBreaks(i, 0, 0, hb), endBreaks(i + 1, 0, 0, hb), 0, -1, colorAt(i, 0))

    const ht = heightAt(i, H - 1)!
    emitWall(i * dx, H * dy, (i + 1) * dx, H * dy,
      endBreaks(i, H, 0, ht), endBreaks(i + 1, H, 0, ht), 0, 1, colorAt(i, H - 1))
  }

  // ---- Bottom (per-cell grid so boundary-wall bottom edges match exactly) ----
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      pushQuad(
        [i * dx, j * dy, 0],
        [i * dx, (j + 1) * dy, 0],
        [(i + 1) * dx, (j + 1) * dy, 0],
        [(i + 1) * dx, j * dy, 0],
        GRAY, 0, 0, -1,
      )
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    triangleCount: positions.length / 9,
  }
}
