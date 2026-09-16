import { MAX_REFERENCE_FILE_BYTES } from './reference3mf'

/**
 * Relief comparison: read a reference STL (HueForge, a slicer, or this app's
 * own export), measure the same surface metrics on it and on the mesh we just
 * built, and line the numbers up row by row.
 *
 * The metrics are the ones that decide whether a relief "looks like" the
 * reference: the footprint, the XY cell pitch, the print-layer step, how many
 * distinct heights the top surface actually uses, and the mix of surface
 * forms (flat plateaus / slanted transitions / vertical walls).
 *
 * Everything here is pure: no DOM, no worker globals, so the same code runs in
 * the parser worker for the reference and on our own mesh.
 */

/** Coordinates are rounded to this many decimals before being counted (mm). */
const GRID_DECIMALS = 3

/** Two heights closer than this are the same level (mm). */
const LEVEL_EPS = 1e-4

export type StlParseErrorCode = 'extension' | 'size' | 'format'

export class StlParseError extends Error {
  readonly code: StlParseErrorCode

  constructor(code: StlParseErrorCode, message: string) {
    super(message)
    this.name = 'StlParseError'
    this.code = code
  }
}

export interface StlInput {
  fileName: string
  data: Uint8Array
}

export interface StlMesh {
  positions: Float32Array
  triangleCount: number
  format: 'binary' | 'ascii'
  /** The file declares more triangles than it carries (partial upload). */
  truncated: boolean
}

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/** ASCII STL bodies are detected by their "solid … facet" opening. */
function looksAscii(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.byteLength))).toLowerCase()
  return head.trimStart().startsWith('solid') && head.includes('facet')
}

function parseAsciiStl(bytes: Uint8Array): { positions: Float32Array; triangleCount: number } {
  const text = new TextDecoder().decode(bytes)
  const re = /vertex\s+(-?[\d.]+(?:[eE][-+]?\d+)?)\s+(-?[\d.]+(?:[eE][-+]?\d+)?)\s+(-?[\d.]+(?:[eE][-+]?\d+)?)/g
  const found: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    found.push(Number(m[1]), Number(m[2]), Number(m[3]))
  }
  const triangleCount = Math.floor(found.length / 9)
  if (triangleCount === 0) {
    throw new StlParseError('format', 'The reference STL holds no triangles.')
  }
  found.length = triangleCount * 9
  return { positions: Float32Array.from(found), triangleCount }
}

/**
 * Read a binary STL body. A truncated file (a partial upload) is read up to
 * its last complete triangle and flagged instead of failing — the metrics
 * below are still meaningful for the part that arrived.
 */
function parseBinaryStl(bytes: Uint8Array): StlMesh {
  if (bytes.byteLength < 84) {
    throw new StlParseError('format', 'The reference is not a readable STL.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const declared = view.getUint32(80, true)
  const fits = Math.floor((bytes.byteLength - 84) / 50)
  const triangleCount = Math.min(declared, fits)
  if (declared === 0 || triangleCount <= 0) {
    throw new StlParseError('format', 'The reference is not a readable STL.')
  }

  const positions = new Float32Array(triangleCount * 9)
  let offset = 84
  for (let t = 0; t < triangleCount; t++) {
    offset += 12 // stored normal — recomputed from the vertices instead
    for (let k = 0; k < 9; k++) {
      positions[t * 9 + k] = view.getFloat32(offset, true)
      offset += 4
    }
    offset += 2 // attribute byte count
  }
  return { positions, triangleCount, format: 'binary', truncated: triangleCount < declared }
}

/**
 * Parse a binary or ASCII STL. The format is decided by the opening bytes — a
 * binary file is allowed to start with "solid", so an ASCII text scan that
 * finds nothing falls back to the binary reader rather than rejecting a valid
 * file.
 */
export function parseStl(input: StlInput): StlMesh {
  const name = input.fileName ?? ''
  // An empty name means "unknown" (a caller without a File); anything named
  // has to be a .stl so a dropped .3mf cannot land here by mistake.
  if (name !== '' && !/\.stl$/i.test(name)) {
    throw new StlParseError('extension', 'Choose a .stl reference file.')
  }
  const bytes = input.data
  if (bytes.byteLength === 0) throw new StlParseError('size', 'The reference file is empty.')
  if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) {
    throw new StlParseError('size', 'The reference file is larger than the 100 MB limit.')
  }

  if (looksAscii(bytes)) {
    try {
      return { ...parseAsciiStl(bytes), format: 'ascii', truncated: false }
    } catch (err) {
      if (!(err instanceof StlParseError) || err.code !== 'format') throw err
      // "solid"-headed binary: fall through to the binary reader.
    }
  }
  return parseBinaryStl(bytes)
}

export interface ReliefMetrics {
  triangleCount: number
  /** Bounding box, mm. */
  sizeX: number
  sizeY: number
  sizeZ: number
  /** Cell pitch of the pixel grid, mm (0 when it cannot be measured). */
  gridStepX: number
  gridStepY: number
  /** Print-layer step between neighbouring surface heights, mm (median gap). */
  heightStep: number
  /** Distinct heights the top surface uses — flat and sloped faces alike. */
  levelCount: number
  plateauZMin: number
  plateauZMax: number
  /** Share of the visible surface (base plate excluded) by orientation. */
  topShare: number
  slantShare: number
  wallShare: number
}

/** Most common positive gap in a sorted list of coordinates. */
function dominantGap(sorted: number[]): number {
  const counts = new Map<number, number>()
  for (let i = 1; i < sorted.length; i++) {
    const d = round(sorted[i] - sorted[i - 1], 4)
    if (d <= LEVEL_EPS) continue
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  let best = 0
  let bestCount = 0
  for (const [d, c] of counts) {
    if (c > bestCount || (c === bestCount && d < best)) {
      best = d
      bestCount = c
    }
  }
  return best
}

/** Median gap between neighbouring values, ignoring rounding noise. */
function medianGap(sorted: number[]): number {
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const d = round(sorted[i] - sorted[i - 1], 4)
    if (d > LEVEL_EPS) gaps.push(d)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}

/**
 * Measure a triangle soup. `gridStepX/Y` can be supplied when the caller
 * already knows the design pitch: a merged mesh only carries vertices where
 * faces end, so its own vertex spacing is coarser than the grid it was built
 * on.
 */
export function measureRelief(
  positions: Float32Array,
  triangleCount: number,
  known?: { gridStepX?: number; gridStepY?: number },
): ReliefMetrics {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const xs = new Set<number>()
  const ys = new Set<number>()
  const zs = new Set<number>()
  let top = 0
  let slant = 0
  let wall = 0

  for (let t = 0; t < triangleCount; t++) {
    const i = t * 9
    const ax = positions[i]
    const ay = positions[i + 1]
    const az = positions[i + 2]
    const bx = positions[i + 3]
    const by = positions[i + 4]
    const bz = positions[i + 5]
    const cx = positions[i + 6]
    const cy = positions[i + 7]
    const cz = positions[i + 8]

    if (ax < minX) minX = ax
    if (bx < minX) minX = bx
    if (cx < minX) minX = cx
    if (ax > maxX) maxX = ax
    if (bx > maxX) maxX = bx
    if (cx > maxX) maxX = cx
    if (ay < minY) minY = ay
    if (by < minY) minY = by
    if (cy < minY) minY = cy
    if (ay > maxY) maxY = ay
    if (by > maxY) maxY = by
    if (cy > maxY) maxY = cy
    if (az < minZ) minZ = az
    if (bz < minZ) minZ = bz
    if (cz < minZ) minZ = cz
    if (az > maxZ) maxZ = az
    if (bz > maxZ) maxZ = bz
    if (cz > maxZ) maxZ = cz
    xs.add(round(ax, GRID_DECIMALS))
    xs.add(round(bx, GRID_DECIMALS))
    xs.add(round(cx, GRID_DECIMALS))
    ys.add(round(ay, GRID_DECIMALS))
    ys.add(round(by, GRID_DECIMALS))
    ys.add(round(cy, GRID_DECIMALS))

    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len === 0) continue
    const area = len / 2
    const flat = 1 - 1e-4
    if (nz > 0) {
      // The height ladder belongs to the whole upward-facing surface: on a
      // stepped mesh only the flat plateaus carry it, while a height map (the
      // reference and this app) also reaches its heights on the sloped faces.
      zs.add(round(az, GRID_DECIMALS))
      zs.add(round(bz, GRID_DECIMALS))
      zs.add(round(cz, GRID_DECIMALS))
      if (nz >= len * flat) top += area
      else slant += area
    } else if (nz <= -len * flat) {
      // Base plate: not part of the visible relief, so it stays out of the mix.
    } else if (Math.abs(nx) >= len * flat || Math.abs(ny) >= len * flat) {
      wall += area
    } else {
      slant += area
    }
  }

  const sortedZ = [...zs].sort((a, b) => a - b)
  const visible = top + slant + wall
  const share = (area: number) => (visible > 0 ? area / visible : 0)
  const unknown = !Number.isFinite(minX) || !Number.isFinite(maxX)

  return {
    triangleCount,
    sizeX: unknown ? 0 : maxX - minX,
    sizeY: unknown ? 0 : maxY - minY,
    sizeZ: unknown ? 0 : maxZ - minZ,
    gridStepX: known?.gridStepX ?? dominantGap([...xs].sort((a, b) => a - b)),
    gridStepY: known?.gridStepY ?? dominantGap([...ys].sort((a, b) => a - b)),
    heightStep: medianGap(sortedZ),
    levelCount: sortedZ.length,
    plateauZMin: sortedZ.length > 0 ? sortedZ[0] : 0,
    plateauZMax: sortedZ.length > 0 ? sortedZ[sortedZ.length - 1] : 0,
    topShare: share(top),
    slantShare: share(slant),
    wallShare: share(wall),
  }
}

export type ReliefRowStatus = 'ok' | 'close' | 'off' | 'info'

export interface ReliefRow {
  /** i18n key of the metric name (see `i18n.ts`, `rcRow*`). */
  key: string
  refText: string
  ownText: string
  deltaText: string
  status: ReliefRowStatus
}

export interface ReliefComparison {
  rows: ReliefRow[]
  /** Rows flagged 'off' — the headline number in the report. */
  diverging: number
}

const fmt = (v: number, digits = 2) => v.toFixed(digits)

/** Thousands grouped with a space: 983460 reads better as 983 460 in a table. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** Percentage points between two shares. */
const pp = (a: number, b: number) => Math.abs(a - b) * 100

/** Relative difference, guarding against a zero reference. */
const rel = (ref: number, own: number) => (ref > 0 ? Math.abs(own - ref) / ref : own === 0 ? 0 : 1)

function pairStatus(refA: number, refB: number, ownA: number, ownB: number, okFrac: number, closeFrac: number): ReliefRowStatus {
  // X and Y may legitimately be swapped: the reference photo can be rotated.
  const straight = Math.max(rel(refA, ownA), rel(refB, ownB))
  const swapped = Math.max(rel(refA, ownB), rel(refB, ownA))
  const best = Math.min(straight, swapped)
  if (best <= okFrac) return 'ok'
  if (best <= closeFrac) return 'close'
  return 'off'
}

/**
 * Line up the reference's metrics against ours. Text is built here (numbers
 * only) so the UI just prints the cells; labels come from i18n by key.
 */
export function compareRelief(reference: ReliefMetrics, own: ReliefMetrics): ReliefComparison {
  const rows: ReliefRow[] = []
  const push = (key: string, refText: string, ownText: string, deltaText: string, status: ReliefRowStatus) => {
    rows.push({ key, refText, ownText, deltaText, status })
  }

  push(
    'rcRowFootprint',
    `${fmt(reference.sizeX)} × ${fmt(reference.sizeY)}`,
    `${fmt(own.sizeX)} × ${fmt(own.sizeY)}`,
    `${(Math.min(rel(reference.sizeX, own.sizeX), rel(reference.sizeX, own.sizeY)) * 100).toFixed(1)}%`,
    pairStatus(reference.sizeX, reference.sizeY, own.sizeX, own.sizeY, 0.005, 0.02),
  )

  push(
    'rcRowHeight',
    fmt(reference.sizeZ),
    fmt(own.sizeZ),
    `${((own.sizeZ - reference.sizeZ) >= 0 ? '+' : '')}${fmt(own.sizeZ - reference.sizeZ)}`,
    rel(reference.sizeZ, own.sizeZ) <= 0.01 ? 'ok' : rel(reference.sizeZ, own.sizeZ) <= 0.05 ? 'close' : 'off',
  )

  push(
    'rcRowGrid',
    `${fmt(reference.gridStepX, 4)} × ${fmt(reference.gridStepY, 4)}`,
    `${fmt(own.gridStepX, 4)} × ${fmt(own.gridStepY, 4)}`,
    `${(Math.min(rel(reference.gridStepX, own.gridStepX), rel(reference.gridStepX, own.gridStepY)) * 100).toFixed(1)}%`,
    pairStatus(reference.gridStepX, reference.gridStepY, own.gridStepX, own.gridStepY, 0.02, 0.1),
  )

  const stepDelta = Math.abs(own.heightStep - reference.heightStep)
  push(
    'rcRowHeightStep',
    fmt(reference.heightStep, 3),
    fmt(own.heightStep, 3),
    `${stepDelta <= 0.001 ? '=' : `${own.heightStep > reference.heightStep ? '+' : '−'}${fmt(stepDelta, 3)}`}`,
    stepDelta <= 0.02 ? 'ok' : stepDelta <= 0.06 ? 'close' : 'off',
  )

  const levelDelta = Math.abs(own.levelCount - reference.levelCount)
  push(
    'rcRowLevels',
    String(reference.levelCount),
    String(own.levelCount),
    levelDelta === 0 ? '=' : `${own.levelCount > reference.levelCount ? '+' : '−'}${levelDelta}`,
    levelDelta === 0 ? 'ok' : levelDelta <= 2 ? 'close' : 'off',
  )

  push(
    'rcRowTriangles',
    grouped(reference.triangleCount),
    grouped(own.triangleCount),
    reference.triangleCount > 0 ? `×${(own.triangleCount / reference.triangleCount).toFixed(2)}` : '—',
    'info',
  )

  const shareRow = (key: string, refShare: number, ownShare: number) => {
    const diff = pp(refShare, ownShare)
    push(
      key,
      `${(refShare * 100).toFixed(1)}%`,
      `${(ownShare * 100).toFixed(1)}%`,
      `${ownShare >= refShare ? '+' : '−'}${diff.toFixed(1)} pp`,
      diff <= 10 ? 'ok' : diff <= 25 ? 'close' : 'off',
    )
  }
  shareRow('rcRowPlateaus', reference.topShare, own.topShare)
  shareRow('rcRowSlants', reference.slantShare, own.slantShare)
  shareRow('rcRowWalls', reference.wallShare, own.wallShare)

  return { rows, diverging: rows.filter((r) => r.status === 'off').length }
}
