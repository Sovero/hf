import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { export3mfFile, exportStl, finishPipeline } from '../lib/pipeline'
import { runReferenceAnalyze, runStlAnalyze } from '../lib/referenceWorkerProtocol'
import type { QuantizedImage } from '../lib/types'

function appExport(): Uint8Array {
  const image = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
  const quantized: QuantizedImage = {
    palette: [
      { r: 0, g: 0, b: 0 },
      { r: 85, g: 85, b: 85 },
      { r: 170, g: 170, b: 170 },
      { r: 255, g: 255, b: 255 },
    ],
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([0.9, 0.6, 0.35, 0.1]),
    bandTops: [0.25, 0.5, 0.75, 1],
    width: 2,
    height: 2,
  }
  const result = finishPipeline(image, quantized, {
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

function appStlExport(): { bytes: Uint8Array; triangleCount: number } {
  const result = finishPipeline(
    { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) },
    quantizedFixture(),
    { numColors: 4, darkIsTall: true, widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, layerMm: 0.2 },
  )
  return { bytes: new Uint8Array(exportStl(result)), triangleCount: result.mesh.triangleCount }
}

function quantizedFixture(): QuantizedImage {
  return {
    palette: [
      { r: 0, g: 0, b: 0 },
      { r: 85, g: 85, b: 85 },
      { r: 170, g: 170, b: 170 },
      { r: 255, g: 255, b: 255 },
    ],
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([1, 2 / 3, 1 / 3, 0]),
    bandTops: [0.25, 0.5, 0.75, 1],
    width: 2,
    height: 2,
  }
}

describe('runReferenceAnalyze', () => {
  it('returns a serializable complete analysis for an app export', async () => {
    const response = await runReferenceAnalyze(appExport())

    expect(response.ok).toBe(true)
    expect(response.result?.status).toBe('complete')
    expect(response.result?.canApply).toBe(true)
    // The response must survive structured clone: no class instances or
    // custom prototypes inside.
    expect(() => structuredClone(response)).not.toThrow()
  })

  it('flattens typed parse errors into { name, message, code }', async () => {
    const zip = zipSync({ 'Metadata/extra.config': strToU8('{}') })
    const response = await runReferenceAnalyze(zip)

    expect(response.ok).toBe(false)
    expect(response.error).toEqual({
      name: 'Reference3mfParseError',
      message: expect.any(String),
      code: 'missing-model',
    })
    expect(() => structuredClone(response)).not.toThrow()
  })
})

describe('runStlAnalyze', () => {
  it('measures a reference STL and returns a cloneable analysis', () => {
    const { bytes, triangleCount } = appStlExport()
    const response = runStlAnalyze({ fileName: 'reference.stl', data: bytes })

    expect(response.ok).toBe(true)
    expect(response.result?.format).toBe('binary')
    expect(response.result?.truncated).toBe(false)
    expect(response.result?.fileSizeBytes).toBe(bytes.byteLength)
    expect(response.result?.metrics.triangleCount).toBe(triangleCount)
    expect(response.result?.metrics.sizeX).toBeCloseTo(40, 3)
    expect(response.result?.metrics.sizeY).toBeCloseTo(40, 3)
    expect(response.result?.metrics.sizeZ).toBeCloseTo(8, 3)
    expect(() => structuredClone(response)).not.toThrow()
  })

  it('flags a partial upload instead of failing', () => {
    const { bytes } = appStlExport()
    const cut = bytes.slice(0, 84 + 50 * 2)
    const response = runStlAnalyze({ fileName: 'reference.stl', data: cut })

    expect(response.ok).toBe(true)
    expect(response.result?.truncated).toBe(true)
    expect(response.result?.metrics.triangleCount).toBe(2)
  })

  it('flattens typed STL errors into { name, message, code }', () => {
    const response = runStlAnalyze({ fileName: 'reference.3mf', data: new Uint8Array(4) })

    expect(response.ok).toBe(false)
    expect(response.error).toEqual({
      name: 'StlParseError',
      message: expect.any(String),
      code: 'extension',
    })
    expect(() => structuredClone(response)).not.toThrow()
  })
})