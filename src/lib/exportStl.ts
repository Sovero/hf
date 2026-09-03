import type { Mesh } from './types'

/**
 * Binary STL: 80-byte ASCII header, uint32 triangle count, then
 * 50 bytes per triangle (12 little-endian floats + uint16 attribute).
 */
export function generateBinaryStl(mesh: Mesh, header = 'hueforge-web'): ArrayBuffer {
  const triangles = mesh.triangleCount
  const buffer = new ArrayBuffer(84 + 50 * triangles)
  const view = new DataView(buffer)

  const headerBytes = new TextEncoder().encode(header.slice(0, 80))
  new Uint8Array(buffer, 0, 80).set(headerBytes)

  view.setUint32(80, triangles, true)

  let out = 84
  const p = mesh.positions
  for (let t = 0; t < triangles; t++) {
    const i = t * 9
    const ax = p[i], ay = p[i + 1], az = p[i + 2]
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]

    // Normal = normalized cross product (B-A) x (C-A); zero for degenerate.
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) {
      nx /= len; ny /= len; nz /= len
    } else {
      nx = 0; ny = 0; nz = 0
    }

    view.setFloat32(out, nx, true); view.setFloat32(out + 4, ny, true); view.setFloat32(out + 8, nz, true)
    view.setFloat32(out + 12, ax, true); view.setFloat32(out + 16, ay, true); view.setFloat32(out + 20, az, true)
    view.setFloat32(out + 24, bx, true); view.setFloat32(out + 28, by, true); view.setFloat32(out + 32, bz, true)
    view.setFloat32(out + 36, cx, true); view.setFloat32(out + 40, cy, true); view.setFloat32(out + 44, cz, true)
    view.setUint16(out + 48, 0, true)
    out += 50
  }

  return buffer
}
