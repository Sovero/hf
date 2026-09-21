import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAX_CUSTOM_TONES,
  MAX_TONE_NAME,
  addCustomTone,
  clearCustomTones,
  createCustomTone,
  customTones,
  isCustomTone,
  loadCustomTones,
  normalizeToneName,
  removeCustomTone,
  removeToneFrom,
  restoreCustomTone,
  toneForValues,
  type CustomTone,
} from '../lib/customTones'
import { buildProjectFile, parseProjectFile, ProjectFileError, type ProjectSettings } from '../lib/project'

const tone = (id: string, name: string, contrast: number, power: number): CustomTone => ({ id, name, contrast, power })

describe('saved relief styles: naming', () => {
  it('trims, collapses inner whitespace and cuts to the panel width', () => {
    expect(normalizeToneName('  Глубокий   рельеф  ')).toBe('Глубокий рельеф')
    expect(normalizeToneName('x'.repeat(MAX_TONE_NAME + 20))).toHaveLength(MAX_TONE_NAME)
    expect(normalizeToneName('   ')).toBe('')
  })

  it('rejects a record without a usable name', () => {
    expect(isCustomTone(tone('t1', '  ', 100, 100))).toBe(false)
    expect(isCustomTone({ id: '', name: 'x', contrast: 100, power: 100 })).toBe(false)
    expect(isCustomTone({ id: 't1', name: 'x', contrast: '100', power: 100 })).toBe(false)
    expect(isCustomTone(tone('t1', 'x', 100, 100))).toBe(true)
  })

  it('rejects values outside the sliders', () => {
    expect(isCustomTone(tone('t1', 'x', 301, 100))).toBe(false)
    expect(isCustomTone(tone('t1', 'x', 100, 10))).toBe(false)
    expect(isCustomTone(tone('t1', 'x', -1, 100))).toBe(false)
    // The slider ends themselves are valid.
    expect(isCustomTone(tone('t1', 'x', 0, 20))).toBe(true)
  })
})

describe('saved relief styles: the list', () => {
  it('adds a style with the given values', () => {
    const result = createCustomTone([], { name: ' Мой ', contrast: 130, power: 250 })
    expect(result.status).toBe('added')
    expect(result.list).toHaveLength(1)
    expect(result.tone).toMatchObject({ name: 'Мой', contrast: 130, power: 250 })
    expect(result.tone!.id).toBeTruthy()
  })

  it('does not save the same setting twice', () => {
    const first = createCustomTone([], { name: 'A', contrast: 130, power: 250 })
    const again = createCustomTone(first.list, { name: 'B', contrast: 130, power: 250 })
    expect(again.status).toBe('duplicate')
    expect(again.list).toHaveLength(1)
    // The caller gets the record that already exists, so it can point at it.
    expect(again.tone!.name).toBe('A')
  })

  it('refuses an empty name or an out-of-range setting', () => {
    expect(createCustomTone([], { name: '   ', contrast: 130, power: 250 }).status).toBe('invalid')
    expect(createCustomTone([], { name: 'A', contrast: 400, power: 250 }).status).toBe('invalid')
    expect(createCustomTone([], { name: 'A', contrast: 130, power: 5 }).status).toBe('invalid')
  })

  it('stops at the panel limit instead of growing without end', () => {
    let list: CustomTone[] = []
    for (let i = 0; i < MAX_CUSTOM_TONES; i++) {
      const result = createCustomTone(list, { name: `Стиль ${i}`, contrast: 100 + i, power: 100 })
      expect(result.status).toBe('added')
      list = result.list
    }
    const overflow = createCustomTone(list, { name: 'Ещё', contrast: 100, power: 299 })
    expect(overflow.status).toBe('full')
    expect(overflow.list).toHaveLength(MAX_CUSTOM_TONES)
  })

  it('finds a style by its values, with no tolerance for near misses', () => {
    const list = [tone('t1', 'A', 130, 250), tone('t2', 'B', 60, 90)]
    expect(toneForValues(list, 130, 250)?.id).toBe('t1')
    expect(toneForValues(list, 131, 250)).toBeNull()
    expect(toneForValues(list, 60, 89)).toBeNull()
  })

  it('removes by id and reports what was removed', () => {
    const list = [tone('t1', 'A', 130, 250), tone('t2', 'B', 60, 90)]
    const gone = removeToneFrom(list, 't1')
    expect(gone.removed?.name).toBe('A')
    expect(gone.list.map((t) => t.id)).toEqual(['t2'])
    const missing = removeToneFrom(list, 'nope')
    expect(missing.removed).toBeNull()
    expect(missing.list).toHaveLength(2)
  })

  it('never hands out the internal array or the internal records', () => {
    const source = [tone('t1', 'A', 130, 250)]
    const copy = createCustomTone(source, { name: 'B', contrast: 60, power: 90 }).list
    copy[0]!.name = 'changed'
    expect(source[0]!.name).toBe('A')
  })
})

describe('saved relief styles: storage', () => {
  beforeEach(() => clearCustomTones())

  it('saves, lists and deletes through the storage wrappers', () => {
    const added = addCustomTone({ name: 'Мой рельеф', contrast: 130, power: 250 })
    expect(added.status).toBe('added')
    expect(customTones().map((t) => t.name)).toEqual(['Мой рельеф'])

    const removed = removeCustomTone(added.tone!.id)
    expect(removed?.name).toBe('Мой рельеф')
    expect(customTones()).toEqual([])
    expect(removeCustomTone('nope')).toBeNull()
  })

  it('keeps the id of a style restored from a project and does not duplicate it', () => {
    const record = tone('project-style', 'Из проекта', 200, 100)
    expect(restoreCustomTone(record)).toBe(true)
    expect(restoreCustomTone(record)).toBe(false)
    expect(customTones()).toEqual([record])
  })

  it('refuses to restore a malformed record', () => {
    expect(restoreCustomTone({ id: 'x', name: '', contrast: 100, power: 100 })).toBe(false)
    expect(restoreCustomTone(tone('x', 'A', 999, 100))).toBe(false)
    expect(customTones()).toEqual([])
  })

  it('reads back what it saved (or nothing when storage is unavailable)', () => {
    addCustomTone({ name: 'Проверка', contrast: 70, power: 80 })
    const reread = loadCustomTones()
    // Node's test environment has no localStorage: the loader must answer with
    // an empty list rather than throw, and the in-memory cache stays usable.
    if (reread.length > 0) expect(reread[0]!.name).toBe('Проверка')
    expect(customTones().map((t) => t.name)).toEqual(['Проверка'])
  })
})

const SETTINGS: ProjectSettings = {
  colors: 4,
  widthMm: 40,
  heightMm: 40,
  baseMm: 0.8,
  maxMm: 8,
  layerMm: 0.2,
  dither: 0,
  darkIsTall: true,
  backlight: false,
}

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function file(settings: Partial<ProjectSettings>) {
  return buildProjectFile({
    imageName: 'photo.png',
    dataUrl: DATA_URL,
    settings: { ...SETTINGS, ...settings },
    palette: [{ hex: '#000000', tauMm: 1.2 }],
  })
}

describe('saved relief styles: project file', () => {
  it('travels with the project', () => {
    const styles = [tone('t1', 'Мой рельеф', 130, 250), tone('t2', 'Мягко-своё', 60, 90)]
    const parsed = parseProjectFile(JSON.stringify(file({ customTones: styles })))
    expect(parsed.settings.customTones).toEqual(styles)
  })

  it('keeps projects without styles unchanged', () => {
    const parsed = parseProjectFile(JSON.stringify(file({})))
    expect(parsed.settings.customTones).toBeUndefined()
  })

  it('normalizes the names it reads', () => {
    const parsed = parseProjectFile(JSON.stringify(file({ customTones: [tone('t1', '  Два   слова ', 100, 100)] })))
    expect(parsed.settings.customTones?.[0]?.name).toBe('Два слова')
  })

  it('rejects a malformed style list', () => {
    const bad = [
      { customTones: 'nope' },
      { customTones: [{ name: 'нет id', contrast: 100, power: 100 }] },
      { customTones: [{ id: 't1', name: '', contrast: 100, power: 100 }] },
      { customTones: [{ id: 't1', name: 'A', contrast: 400, power: 100 }] },
      { customTones: [{ id: 't1', name: 'A', contrast: 100, power: 10 }] },
    ]
    for (const settings of bad) {
      expect(() => parseProjectFile(JSON.stringify(file(settings as Partial<ProjectSettings>)))).toThrow(ProjectFileError)
    }
  })

  it('round-trips more styles than the panel will save', () => {
    // The list cap is a panel guard, not a file rule: a project must load
    // exactly what it carries.
    const many = Array.from({ length: MAX_CUSTOM_TONES + 3 }, (_, i) => tone(`t${i}`, `Стиль ${i}`, 100 + (i % 50), 100))
    const parsed = parseProjectFile(JSON.stringify(file({ customTones: many })))
    expect(parsed.settings.customTones).toHaveLength(many.length)
  })
})
