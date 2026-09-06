import { zipSync, strToU8 } from 'fflate'
import type { Mesh, RGB } from './types'

/** One palette band in the tool-change schedule. */
export interface PaletteBand {
  color: RGB
  /** Top surface height of this band in mm. */
  topZMm: number
  /** 1 = first filament loaded, N = last (top) color. */
  printOrder: number
}

interface ExportOptions {
  mesh: Mesh
  modelName: string
  /**
   * Palette bands, used to build the Bambu Studio tool-change schedule.
   * Colors are baked into `Metadata/custom_gcode_per_layer.xml` + the
   * filament settings, exactly like a HueForge-style Bambu Studio project.
   */
  bands: PaletteBand[]
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
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')
}

/** Compact hex like "#303030" (no alpha) — Bambu Studio format. */
function hex6(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * Export a Bambu Studio project 3MF for the stepped relief:
 * - `3D/3dmodel.model` — the mesh as a single object (no per-triangle
 *   colors; the slicer assigns colors by layer height, HueForge-style)
 * - `Metadata/custom_gcode_per_layer.xml` — a tool change at the top of
 *   every color band, each carrying its extruder number + hex color
 * - `Metadata/filament_settings_1.config` — the filament profile with the
 *   base color (Bambu reads the band colors from the layer schedule)
 * - `Metadata/model_settings.config` — object/plate mapping
 *
 * Opening the file in Bambu Studio / OrcaSlicer shows one model with the
 * full multi-color swap schedule, exactly like a HueForge export.
 */
export function generate3mf(opts: ExportOptions): Uint8Array {
  const { mesh, modelName, bands, printSettings } = opts

  // ---- Mesh part: deduplicated vertices, plain triangles (no materials) ----
  const vertexIndex = new Map<string, number>()
  const vertexLines: string[] = []
  const triangleLines: string[] = []

  const p = mesh.positions
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
        vertexLines.push(`    <vertex x="${x}" y="${y}" z="${z}"/>`)
      }
      v.push(idx)
    }
    triangleLines.push(`    <triangle v1="${v[0]}" v2="${v[1]}" v3="${v[2]}"/>`)
  }

  const faceCount = mesh.triangleCount

  const meta = Object.entries(printSettings ?? {})
    .map(([k, v]) => `  <metadata name="${esc(k)}">${esc(v)}</metadata>`)
    .join('\n')

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">hueforge-web</metadata>
  <metadata name="Title">${esc(modelName)}</metadata>
${meta}
  <resources>
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

  // ---- Tool-change schedule: swap to extruder k at the top of band k-1 ----
  const byOrder = [...bands].sort((a, b) => a.printOrder - b.printOrder)
  // Tallest point of the geometry — a change above it would print nothing.
  let maxZ = 0
  const meshPos = mesh.positions
  for (let i = 2; i < meshPos.length; i += 3) {
    if (meshPos[i] > maxZ) maxZ = meshPos[i]
  }
  const layerLines: string[] = []
  for (let k = 1; k < byOrder.length; k++) {
    const topZ = Number(byOrder[k - 1].topZMm.toFixed(6))
    if (topZ >= maxZ - 1e-9) continue // grid snapping can overshoot the top
    const color = byOrder[k].color
    layerLines.push(
      `<layer top_z="${topZ}" type="2" extruder="${k + 1}" color="${hex6(color.r, color.g, color.b)}" extra="" gcode="tool_change"/>`,
    )
  }

  const gcodePerLayer = `<?xml version="1.0" encoding="utf-8"?>
<custom_gcodes_per_layer>
<plate>
<plate_info id="1"/>
${layerLines.join('\n')}
<mode value="MultiAsSingle"/>
</plate>
</custom_gcodes_per_layer>
`

  // ---- Filament settings: one profile, base color = first band in print order ----
  const baseColor = byOrder[0]?.color ?? { r: 128, g: 128, b: 128 }
  const filamentSettings = JSON.stringify(
    {
      default_filament_colour: [hex6(baseColor.r, baseColor.g, baseColor.b)],
      filament_flow_ratio: ['0.975'],
      filament_settings_id: ['HueForgeWeb'],
      filament_vendor: ['Generic'],
      from: 'project',
      hot_plate_temp: ['60'],
      hot_plate_temp_initial_layer: ['60'],
      inherits: 'Generic PLA',
      name: 'HueForgeWeb',
      temperature_vitrification: ['60'],
      version: '1.8.4.50',
    },
    null,
    4,
  )

  // ---- Model settings: object id 2 → plate 1 ----
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="${esc(modelName)}"/>
    <metadata key="extruder" value="1"/>
    <metadata face_count="${faceCount}"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="${esc(modelName)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="source_object_id" value="0"/>
      <metadata key="source_volume_id" value="0"/>
      <metadata key="source_offset_x" value="0"/>
      <metadata key="source_offset_y" value="0"/>
      <metadata key="source_offset_z" value="0"/>
      <mesh_stat face_count="${faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="2"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
    <assemble_item object_id="2" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0"/>
  </assemble>
</config>
`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    '3D/3dmodel.model': strToU8(modelXml),
    'Metadata/custom_gcode_per_layer.xml': strToU8(gcodePerLayer),
    'Metadata/filament_settings_1.config': strToU8(filamentSettings),
    'Metadata/model_settings.config': strToU8(modelSettings),
  }
  return zipSync(files)
}