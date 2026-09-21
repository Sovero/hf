import type { ToneCurve } from './quantize'

/**
 * Named relief styles.
 *
 * The two tone knobs are multipliers on the picture's own tones, which is
 * precise but says nothing about what the print will look like. Each preset
 * here is a named look, with the multipliers it stands for: the numbers stay in
 * the UI as the fine-tuning step, but choosing a style is one click and the
 * name says what changes.
 *
 * The multiplier pairs mirror the two effects the curve has:
 *
 * - contrast < 1 pulls every tone towards the middle of the range (a flat,
 *   soft relief), > 1 pushes the tones apart (steps become crisper);
 * - detail < 1 lifts the mid-tones (an even, washed surface), > 1 sinks them
 *   towards the base so peaks stand alone (deep relief).
 *
 * Every value is a multiple of 10 % — the step the sliders themselves use — so
 * a preset always lands exactly on the sliders and the «style» highlight never
 * flickers between two states.
 */
export type TonePresetId = 'soft' | 'photo' | 'deep' | 'graphic'

export interface TonePreset {
  id: TonePresetId
  /** Relief contrast multiplier (slider % / 100). */
  contrast: number
  /** Detail deepening multiplier (slider % / 100). */
  power: number
}

/** Neutral, i.e. the picture's own tones — the reference point for the rest. */
export const NEUTRAL_TONE: ToneCurve = { contrast: 1, power: 1 }

export const TONE_PRESETS: readonly TonePreset[] = [
  // Tones keep together in the middle of the relief: gentle slopes, no steep
  // steps, usable when the picture should read softly on the wall. Measured on
  // a 64×64 tonal ramp the surface bunches up (profile spread 9.1 against 15.7
  // for «photo»).
  { id: 'soft', contrast: 0.6, power: 0.9 },
  // One to one: height follows brightness, nothing is exaggerated.
  { id: 'photo', contrast: 1, power: 1 },
  // Mid-tones sink towards the base while the highlights stay up: the classic
  // HueForge depth. On the same ramp the mass of the surface moves from the
  // middle of the relief (bin 8.1) down to 4.8 of 16, and it spreads wider
  // (22.3) because the peaks stay where they were.
  { id: 'deep', contrast: 1.3, power: 2.5 },
  // Tones spread out to the extremes: crisp steps between colours, more of an
  // engraved look than a photograph.
  { id: 'graphic', contrast: 2, power: 1 },
]

/**
 * The preset the sliders currently hold, or null when they were moved by hand.
 * Matching is exact on the slider grid, so a fitted tone (which lands on the
 * same 10 % grid) still counts as its own setting rather than as a preset.
 */
export function matchTonePreset(contrast: number, power: number, epsilon = 1e-9): TonePresetId | null {
  for (const preset of TONE_PRESETS) {
    if (Math.abs(preset.contrast - contrast) <= epsilon && Math.abs(preset.power - power) <= epsilon) {
      return preset.id
    }
  }
  return null
}

/** The preset with this id; throws for an unknown id (programming error). */
export function tonePreset(id: TonePresetId): TonePreset {
  const found = TONE_PRESETS.find((p) => p.id === id)
  if (!found) throw new Error(`Unknown relief preset: ${id}`)
  return found
}

/** Percent values a preset writes into the two sliders (100 = unchanged). */
export function presetPercents(preset: TonePreset): { contrast: number; power: number } {
  return { contrast: Math.round(preset.contrast * 100), power: Math.round(preset.power * 100) }
}
