import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from './types'

interface ExportOptions {
  mesh: Mesh
  modelName: string
  /** Optional print hints recorded as 3MF metadata. */
  printSettings?: Record<string, string>
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function srgbHexWithAlpha(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}FF`
}

/**
 * Export the mesh as a minimal, spec-compliant 3MF package:
 * - vertices deduplicated
 * - one basematerials resource holding every distinct face color
 * - each triangle tagged with p1/pid → its color
 */
export function generate3mf(opts: ExportOptions): Uint8Array {
  const { mesh, modelName, printSettings } = opts

  const vertexIndex = new Map<string, number>()
  const materialIndex = new Map<string, number>()
  const materials: string[] = []
  const vertexLines: string[] = []
  const triangleLines: string[] = []

  const p = mesh.positions
  const c = mesh.colors

  for (let t = 0; t < mesh.triangleCount; t++) {
    const i = t * 9
    const v: number[] = []
    for (let k = 0; k < 3; k++) {
      const x = p[i + k * 3]
      const y = p[i + k * 3 + 1]
      const z = p[i + k * 3 + 2]
      const key = `${x},${y},${z}`
      let idx = vertexIndex.get(key)
      if (idx === undefined) {
        idx = vertexIndex.size
        vertexIndex.set(key, idx)
        vertexLines.push(`        <vertex x="${x}" y="${y}" z="${z}"/>`)
      }
      v.push(idx)
    }

    // Face color: all three vertices share it (flat-shaded quads).
    const r = Math.round(c[i] * 255)
    const g = Math.round(c[i + 1] * 255)
    const b = Math.round(c[i + 2] * 255)
    const colorKey = `${r},${g},${b}`
    let mat = materialIndex.get(colorKey)
    if (mat === undefined) {
      mat = materials.length
      materialIndex.set(colorKey, mat)
      materials.push(`      <base name="Color ${mat}" displaycolor="${srgbHexWithAlpha(r, g, b)}"/>`)
    }

    triangleLines.push(
      `        <triangle v1="${v[0]}" v2="${v[1]}" v3="${v[2]}" pid="1" p1="${mat}"/>`,
    )
  }

  const meta = Object.entries(printSettings ?? {})
    .map(([k, v]) => `  <metadata name="${esc(k)}">${esc(v)}</metadata>`)
    .join('\n')

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">hueforge-web</metadata>
  <metadata name="Title">${esc(modelName)}</metadata>
${meta}
  <resources>
    <basematerials id="1">
${materials.join('\n')}
    </basematerials>
    <object id="2" type="model">
      <mesh>
        <vertices>
${vertexLines.join('\n')}
        </vertices>
        <triangles>
${triangleLines.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2"/>
  </build>
</model>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    '3D/3dmodel.model': strToU8(modelXml),
  }
  return zipSync(files)
}
