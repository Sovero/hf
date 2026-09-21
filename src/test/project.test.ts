import { describe, it, expect } from 'vitest'
import {
  buildProjectFile,
  parseProjectFile,
  ProjectFileError,
  PROJECT_APP,
  PROJECT_VERSION,
  type ProjectFile,
  type ProjectSettings,
} from '../lib/project'
import { addCustomFilament, customFilaments, findFilament, restoreCustomFilament } from '../lib/filamentLibrary'

const SETTINGS: ProjectSettings = {
  colors: 8,
  widthMm: 150,
  heightMm: 120,
  baseMm: 0.8,
  maxMm: 8,
  layerMm: 0.2,
  dither: 35,
  darkIsTall: true,
  backlight: true,
}

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function sample(): ProjectFile {
  return buildProjectFile({
    imageName: 'photo.png',
    dataUrl: DATA_URL,
    settings: SETTINGS,
    palette: [
      { hex: '#1c1c1e', tauMm: 1.2, filamentId: 'u3print:pla:black' },
      { hex: '#c22a24', tauMm: 1.0 },
    ],
  })
}

describe('project save/load', () => {
  it('roundtrips smooth strength and leaves old files without the field', () => {
    const withSmooth = parseProjectFile(
      JSON.stringify({ ...sample(), settings: { ...sample().settings, smooth: 45 } }),
    )
    expect(withSmooth.settings.smooth).toBe(45)

    const old = sample()
    expect((old.settings as ProjectSettings).smooth).toBeUndefined()
  })

  it('roundtrips through JSON without loss', () => {
    const project = sample()
    const parsed = parseProjectFile(JSON.stringify(project))
    expect(parsed).toEqual(project)
    expect(parsed.app).toBe(PROJECT_APP)
    expect(parsed.version).toBe(PROJECT_VERSION)
  })

  it('roundtrips per-band heights and falls back to equal bands when absent', () => {
    const palette = Array.from({ length: 8 }, (_, i) => ({ hex: `#${String(i).repeat(6)}`, tauMm: 1.0 }))
    const withHeights = buildProjectFile({
      imageName: 'photo.png',
      dataUrl: DATA_URL,
      settings: { ...SETTINGS, bandHeightsMm: [1.2, 0.9, 0.6, 0.4, 0.5, 0.6, 0.7, 0.8] },
      palette,
    })
    const parsed = parseProjectFile(JSON.stringify(withHeights))
    expect(parsed.settings.bandHeightsMm).toEqual([1.2, 0.9, 0.6, 0.4, 0.5, 0.6, 0.7, 0.8])

    const plain = parseProjectFile(JSON.stringify(sample()))
    expect(plain.settings.bandHeightsMm).toBeUndefined()
  })

  it('rejects a corrupt bandHeightsMm array', () => {
    for (const bad of ['x', [1, -1, 1, 1], [1, 2], [0.1, Number.NaN, 1, 1]]) {
      const text = JSON.stringify({ ...sample(), settings: { ...sample().settings, bandHeightsMm: bad } })
      expect(() => parseProjectFile(text)).toThrow(ProjectFileError)
    }
  })

  it('serializes custom filaments in full so projects are portable', () => {
    const custom = addCustomFilament({ name: 'Мой красный', hex: '#ff3300', materialId: 'pla' })
    const project = buildProjectFile({
      imageName: 'x.png',
      dataUrl: DATA_URL,
      settings: SETTINGS,
      palette: [{ hex: '#ff3300', tauMm: 1.1, filament: { id: custom.id, nameRu: custom.nameRu, nameEn: custom.nameEn, hex: custom.hex, materialId: custom.materialId } }],
    })
    const parsed = parseProjectFile(JSON.stringify(project))
    expect(parsed.palette[0].filament?.id).toBe(custom.id)
    expect(parsed.palette[0].filament?.hex).toBe(custom.hex)
  })

  it('rejects malformed files with ProjectFileError', () => {
    const cases: [string, string][] = [
      ['not json at all', 'not json'],
      ['empty object', '{}'],
      ['wrong app', JSON.stringify({ ...sample(), app: 'other' })],
      ['wrong version', JSON.stringify({ ...sample(), version: 99 })],
      ['missing image', JSON.stringify({ ...sample(), image: { name: 'x.png' } })],
      ['bad data URL', JSON.stringify({ ...sample(), image: { name: 'x.png', dataUrl: 'https://x' } })],
      ['bad hex', JSON.stringify({ ...sample(), palette: [{ hex: 'red', tauMm: 1 }] })],
      ['non-finite tau', JSON.stringify({ ...sample(), palette: [{ hex: '#000000', tauMm: NaN }] })],
      ['non-finite settings', JSON.stringify({ ...sample(), settings: { ...SETTINGS, widthMm: Infinity } })],
      ['non-boolean darkIsTall', JSON.stringify({ ...sample(), settings: { ...SETTINGS, darkIsTall: 'yes' } })],
      ['empty palette', JSON.stringify({ ...sample(), palette: [] })],
      ['incomplete filament', JSON.stringify({ ...sample(), palette: [{ hex: '#000000', tauMm: 1, filament: { id: 'my:pla:x' } }] })],
    ]
    for (const [label, text] of cases) {
      expect(() => parseProjectFile(text), label).toThrow(ProjectFileError)
    }
  })

  it('restoreCustomFilament registers an embedded filament exactly once', () => {
    const added = restoreCustomFilament({
      id: 'my:pla:proj123',
      nameRu: 'Из проекта',
      nameEn: 'From project',
      hex: '#123456',
      rgb: { r: 0x12, g: 0x34, b: 0x56 },
      materialId: 'pla',
    })
    expect(added).toBe(true)
    expect(customFilaments().some((f) => f.id === 'my:pla:proj123')).toBe(true)
    expect(findFilament('my:pla:proj123')?.color.nameRu).toBe('Из проекта')
    // Idempotent: the same record must not be duplicated.
    expect(
      restoreCustomFilament({ id: 'my:pla:proj123', nameRu: 'Из проекта', nameEn: '', hex: '#123456', rgb: { r: 0x12, g: 0x34, b: 0x56 }, materialId: 'pla' }),
    ).toBe(false)
    expect(customFilaments().filter((f) => f.id === 'my:pla:proj123')).toHaveLength(1)
  })
})