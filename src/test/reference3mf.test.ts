import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { export3mfFile, finishPipeline } from '../lib/pipeline'
import { parseReference3mf } from '../lib/reference3mf'
import type { QuantizedImage, RGB } from '../lib/types'

const PALETTE: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 85, g: 85, b: 85 },
  { r: 170, g: 170, b: 170 },
  { r: 255, g: 255, b: 255 },
]

function fixture(): QuantizedImage {
  return {
    palette: PALETTE,
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([1, 2 / 3, 1 / 3, 0]),
    bandTops: [0.25, 0.5, 0.75, 1],
    width: 2,
    height: 2,
  }
}

function appExport(): Uint8Array {
  const image = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
  const result = finishPipeline(image, fixture(), {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
  })
  return export3mfFile(result, 'reference')
}

function externalBambuFixture(): Uint8Array {
  const model = `<?xml version="1.0"?>
    <model unit="millimeter">
      <resources>
        <object id="1" type="model">
          <mesh>
            <vertices>
              <vertex x="0" y="0" z="0"/>
              <vertex x="20" y="0" z="0"/>
              <vertex x="20" y="30" z="4"/>
            </vertices>
            <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
          </mesh>
        </object>
      </resources>
      <build><item objectid="1"/></build>
    </model>`
  const custom = `<?xml version="1.0"?><custom_gcodes_per_layer><plate>
    <layer top_z="2.0" extruder="2" color="#ff0000"/>
  </plate></custom_gcodes_per_layer>`
  const filament = JSON.stringify({ default_filament_colour: ['#000000'] })
  return zipSync({
    '3D/3dmodel.model': strToU8(model),
    'Metadata/custom_gcode_per_layer.xml': strToU8(custom),
    'Metadata/filament_settings_1.config': strToU8(filament),
  })
}

describe('parseReference3mf', () => {
  it('round-trips the app export metadata and schedule', async () => {
    const analysis = await parseReference3mf(appExport())

    expect(analysis.status).toBe('complete')
    expect(analysis.canApply).toBe(true)
    expect(analysis.model.widthMm).toBeCloseTo(40)
    expect(analysis.model.heightMm).toBeCloseTo(40)
    expect(analysis.model.maxHeightMm).toBeCloseTo(8)
    expect(analysis.model.triangleCount).toBeGreaterThan(0)
    expect(analysis.palette.map((entry) => entry.printOrder)).toEqual([1, 2, 3, 4])
    expect(analysis.palette.map((entry) => entry.hex)).toEqual(['#ffffff', '#aaaaaa', '#555555', '#000000'])
    expect(analysis.swaps.map((swap) => swap.topZMm)).toEqual([2.6, 4.4, 6.2])
    expect(analysis.settings).toMatchObject({
      colorCount: 4,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
      layerMm: 0.2,
      darkIsTall: true,
      bandTops: [0.25, 0.5, 0.75, 1],
    })
  })

  it('returns a partial report for Bambu-style metadata without inventing settings', async () => {
    const analysis = await parseReference3mf(externalBambuFixture())

    expect(analysis.status).toBe('partial')
    expect(analysis.model.widthMm).toBe(20)
    expect(analysis.model.heightMm).toBe(30)
    expect(analysis.model.maxHeightMm).toBe(4)
    expect(analysis.palette.map((entry) => entry.hex)).toEqual(['#000000', '#ff0000'])
    expect(analysis.swaps).toEqual([{ topZMm: 2, extruder: 2, color: { r: 255, g: 0, b: 0 }, hex: '#ff0000' }])
    expect(analysis.settings.baseMm).toBeUndefined()
    expect(analysis.settings.layerMm).toBeUndefined()
    expect(analysis.missingFields).toContain('baseMm')
    expect(analysis.missingFields).toContain('layerMm')
    expect(analysis.warnings.some((warning) => warning.includes('Base height'))).toBe(true)
  })

  it('rejects an invalid archive through a typed error', async () => {
    await expect(parseReference3mf(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      name: 'Reference3mfParseError',
      code: 'archive',
    })
  })

  it('rejects a malformed model XML', async () => {
    const zip = zipSync({ '3D/3dmodel.model': strToU8('<model unit="millimeter"><resources>') })
    await expect(parseReference3mf(zip)).rejects.toMatchObject({
      name: 'Reference3mfParseError',
      code: 'xml',
    })
  })

  it('rejects an archive with no model part through a typed error', async () => {
    const zip = zipSync({ 'Metadata/extra.config': strToU8('{}') })
    await expect(parseReference3mf(zip)).rejects.toMatchObject({
      name: 'Reference3mfParseError',
      code: 'missing-model',
    })
  })

  it('does not expose unrecognized package entries as data', async () => {
    const files = unzipSync(appExport())
    files['Metadata/secret.txt'] = strToU8('must not be read')
    const analysis = await parseReference3mf(zipSync(files))
    expect(analysis.warnings.join(' ')).not.toContain('must not be read')
  })
})
