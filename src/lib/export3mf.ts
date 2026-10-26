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
  <metadata name="Application">BambuStudio-01.09.05.51</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
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

  // ---- Filament settings: one profile per slot, color = that band's color ----
  // (N files so a single preset cannot overwrite the other slots' colors.)
  const layerMmStr = String(printSettings?.LayerMm ?? '0.2')
  const filamentFiles: Record<string, string> = {}
  const filamentSettingsIds: string[] = []
  const filamentColours: string[] = []
  const filamentDiameters: string[] = []
  const filamentTypes: string[] = []
  const filamentDensities: string[] = []
  const filamentCosts: string[] = []
  const filamentFlowRatios: string[] = []
  const filamentIds: string[] = []
  const filamentVendors: string[] = []
  const filamentSolubles: string[] = []
  const filamentIsSupports: string[] = []
  const filamentMaxVolumetricSpeeds: string[] = []

  for (let i = 0; i < byOrder.length; i++) {
    const band = byOrder[i]
    const colorHex = hex6(band.color.r, band.color.g, band.color.b)
    filamentColours.push(colorHex)
    filamentSettingsIds.push('HueForgeWeb')
    filamentDiameters.push('1.75')
    filamentTypes.push('PLA')
    filamentDensities.push('1.24')
    filamentCosts.push('24.99')
    filamentFlowRatios.push('0.98')
    filamentIds.push('GFL99')
    filamentVendors.push('Generic')
    filamentSolubles.push('0')
    filamentIsSupports.push('0')
    filamentMaxVolumetricSpeeds.push('15')

    const perFilament = JSON.stringify(
      {
        default_filament_colour: [colorHex],
        filament_flow_ratio: ['0.98'],
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
    filamentFiles[`Metadata/filament_settings_${i + 1}.config`] = perFilament
  }

  // Keep a base-color filament_settings_1.config for back-compat (already above).
  const baseColor = byOrder[0]?.color ?? { r: 128, g: 128, b: 128 }
  const filamentSettings = JSON.stringify(
    {
      default_filament_colour: [hex6(baseColor.r, baseColor.g, baseColor.b)],
      filament_flow_ratio: ['0.98'],
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
  filamentFiles['Metadata/filament_settings_1.config'] = filamentSettings

  // ---- Project settings: N filaments so Bambu Studio sees all colors ----
  const n = byOrder.length
  // Bambu Studio and OrcaSlicer purge exactly what `flush_volumes_matrix`
  // says: zero means "no purge at all", so the first layers after a swap
  // would still carry the previous color. 140 mm³ is the stock PLA→PLA
  // purge; the diagonal (same color) stays at zero.
  const FLUSH_VOLUME_MM3 = 140
  const flushMatrix: string[] = []
  for (let from = 0; from < n; from++) {
    for (let to = 0; to < n; to++) {
      flushMatrix.push(from === to ? '0' : String(FLUSH_VOLUME_MM3))
    }
  }
  const projectSettings = JSON.stringify(
    {
      name: 'project_settings',
      from: 'project',
      layer_height: layerMmStr,
      initial_layer_print_height: layerMmStr,
      sparse_infill_density: '100%',
      // At 100% density Orca/QIDI rejects `cubic` (its own default) with
      // "cubic doesn't work at 100% density" and asks to switch to
      // rectilinear. Write the compatible pattern explicitly so the project
      // opens cleanly in every Orca-based slicer (QIDI Studio included).
      sparse_infill_pattern: 'rectilinear',
      enable_support: '0',
      enable_prime_tower: '1',
      filament_diameter: filamentDiameters,
      filament_colour: filamentColours,
      filament_settings_id: filamentSettingsIds,
      filament_type: filamentTypes,
      filament_density: filamentDensities,
      filament_cost: filamentCosts,
      filament_flow_ratio: filamentFlowRatios,
      filament_ids: filamentIds,
      filament_vendor: filamentVendors,
      filament_soluble: filamentSolubles,
      filament_is_support: filamentIsSupports,
      filament_max_volumetric_speed: filamentMaxVolumetricSpeeds,
      flush_volumes_matrix: flushMatrix,
      version: '01.09.05.51',
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
    'Metadata/project_settings.config': strToU8(projectSettings),
    'Metadata/model_settings.config': strToU8(modelSettings),
  }
  for (const [path, content] of Object.entries(filamentFiles)) {
    files[path] = strToU8(content)
  }
  return zipSync(files)
}