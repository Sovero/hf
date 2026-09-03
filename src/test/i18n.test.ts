import { describe, it, expect } from 'vitest'
import { t, word, mmOf } from '../i18n'
import { nearestFilament } from '../lib/palette'

describe('i18n', () => {
  it('formats tokens into dictionary entries', () => {
    expect(t('en', 'ready', { colors: '16 colors' })).toBe('Ready — 16 colors.')
    expect(t('ru', 'ready', { colors: '16 цветов' })).toBe('Готово — 16 цветов.')
  })

  it('English pluralization is singular/plural', () => {
    expect(word('en', 1, 'colors')).toBe('1 color')
    expect(word('en', 0, 'colors')).toBe('0 colors')
    expect(word('en', 24, 'colors')).toBe('24 colors')
  })

  it('Russian pluralization follows the 1/2-4/5 rules', () => {
    expect(word('ru', 1, 'colors')).toBe('1 цвет')
    expect(word('ru', 2, 'colors')).toBe('2 цвета')
    expect(word('ru', 4, 'colors')).toBe('4 цвета')
    expect(word('ru', 5, 'colors')).toBe('5 цветов')
    expect(word('ru', 11, 'colors')).toBe('11 цветов')
    expect(word('ru', 21, 'colors')).toBe('21 цвет')
    expect(word('ru', 24, 'colors')).toBe('24 цвета')
    expect(word('ru', 102, 'colors')).toBe('102 цвета')
    expect(word('ru', 40, 'layers')).toBe('40 слоёв')
  })

  it('fractional counts take the Russian "few" form (1.6 слоя)', () => {
    expect(word('ru', 1.6, 'layers')).toBe('1.6 слоя')
    expect(word('ru', 0.5, 'layers')).toBe('0.5 слоя')
  })

  it('formats mm with the language unit', () => {
    expect(mmOf('en', 0.4)).toBe('0.40 mm')
    expect(mmOf('ru', 0.4)).toBe('0.40 мм')
  })

  it('localizes nearest-filament names', () => {
    const nearBlack = { r: 20, g: 20, b: 20 }
    expect(nearestFilament(nearBlack, 'en')).toBe('Black')
    expect(nearestFilament(nearBlack, 'ru')).toBe('Чёрный')
    const nearRed = { r: 210, g: 40, b: 40 }
    expect(nearestFilament(nearRed, 'en')).toBe('Red')
    expect(nearestFilament(nearRed, 'ru')).toBe('Красный')
    expect(nearestFilament({ r: 245, g: 245, b: 245 }, 'ru')).toBe('Белый')
  })
})
