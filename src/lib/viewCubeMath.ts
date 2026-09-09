/**
 * Pure ViewCube math (no three.js, no DOM): classifying a click on the
 * orientation cube into a zone (face / edge / corner) and mapping that zone
 * to a viewing direction.
 *
 * Coordinate system matches the 3D scene: Y-up, +Z toward the default
 * camera, so cube faces carry the same names as Fusion 360's ViewCube.
 */

export type FaceName = 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Outward normal of each cube face in scene space. */
export const FACE_DIRS: Record<FaceName, Vec3> = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
}

/** Canonical zone ids sort alphabetically: 'front+top', 'front+right+top', … */
const ORDER: FaceName[] = ['back', 'bottom', 'front', 'left', 'right', 'top']

export interface CubeZone {
  /** Canonical zone id, e.g. 'front', 'front+top', 'front+right+top'. */
  id: string
  /** Primary (clicked) face first, then adjacent faces of touched borders. */
  faces: FaceName[]
}

/** Face across the positive/negative side of each axis. */
function faceForAxis(axis: 'x' | 'y' | 'z', positive: boolean): FaceName {
  if (axis === 'x') return positive ? 'right' : 'left'
  if (axis === 'y') return positive ? 'top' : 'bottom'
  return positive ? 'front' : 'back'
}

/**
 * Classify a point on the cube surface (local space, cube spans [-half, half]
 * on every axis) into a zone. The dominant axis picks the clicked face; each
 * tangent axis in the outer quarter of its range adds the adjacent face,
 * giving edges and corners — like Fusion 360, the central half of a face is
 * the face itself, the border strips are edges, the corners are corners.
 * The same edge/corner classifies identically from any adjacent face.
 */
export function zoneForLocalPoint(px: number, py: number, pz: number, half: number): CubeZone {
  const axes = [
    { axis: 'x' as const, c: px },
    { axis: 'y' as const, c: py },
    { axis: 'z' as const, c: pz },
  ]
  let dominant = axes[0]
  for (const a of axes) {
    if (Math.abs(a.c) > Math.abs(dominant.c)) dominant = a
  }

  const faces: FaceName[] = [faceForAxis(dominant.axis, dominant.c >= 0)]
  for (const a of axes) {
    if (a === dominant) continue
    const u = a.c / half // -1..1 across the face
    if (u >= 0.5) faces.push(faceForAxis(a.axis, true))
    else if (u <= -0.5) faces.push(faceForAxis(a.axis, false))
  }

  const sorted = [...new Set(faces)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  return { id: sorted.join('+'), faces }
}

/** Normalized viewing direction for a zone: the sum of its face normals. */
export function viewDirForZone(faces: FaceName[]): Vec3 {
  const v = { x: 0, y: 0, z: 0 }
  for (const f of faces) {
    const d = FACE_DIRS[f]
    v.x += d.x
    v.y += d.y
    v.z += d.z
  }
  const len = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** Polar-angle clamp for near-vertical views (avoids lookAt degeneracy). */
export const PHI_EPS = 0.02

export interface Spherical {
  theta: number
  phi: number
}

/**
 * three.js-convention spherical angles of a direction (theta measured from
 * +Z toward +X, phi from +Y). Phi is clamped away from the poles so the
 * camera never looks exactly along its up vector.
 */
export function sphericalFor(dir: Vec3): Spherical {
  const len = Math.hypot(dir.x, dir.y, dir.z)
  const phi = Math.acos(Math.min(1, Math.max(-1, dir.y / len)))
  return {
    theta: Math.atan2(dir.x, dir.z),
    phi: Math.min(Math.PI - PHI_EPS, Math.max(PHI_EPS, phi)),
  }
}

/** Standard smooth step easing for camera flights. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
