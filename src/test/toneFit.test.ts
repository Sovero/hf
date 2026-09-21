import { describe, it, expect } from 'vitest'
import {
  pickBest,
  refineCandidates,
  runToneFit,
  toneCandidates,
  toneScore,
  type ScoredCandidate,
  type ToneCandidate,
} from '../lib/toneFit'
import { measureRelief, PROFILE_BINS, profileDistance, type ReliefMetrics } from '../lib/reliefCompare'
import { mapToLuminanceBands } from '../lib/quantize'
import { finishPipeline, type PipelineOptions } from '../lib/pipeline'
import { resetWorkerState, runFitToneTask, runWorkerTask } from '../lib/workerProtocol'

/** Metrics stub: only the fields the tone score reads need to be real. */
function metrics(profile: number[], shape: Partial<ReliefMetrics> = {}): ReliefMetrics {
  const sum = profile.reduce((a, c) => a + c, 0)
  const norm = sum > 0 ? profile.map((v) => v / sum) : profile
  return {
    triangleCount: 0,
    sizeX: 0,
    sizeY: 0,
    sizeZ: 0,
    gridStepX: 0,
    gridStepY: 0,
    heightStep: 0,
    levelCount: 0,
    plateauZMin: 0,
    plateauZMax: 0,
    topShare: 0.5,
    slantShare: 0.4,
    wallShare: 0.1,
    heightProfile: norm,
    ...shape,
  }
}

/** A profile with all its mass in one bin — far from anything else. */
function spike(bin: number): number[] {
  const out = new Array<number>(PROFILE_BINS).fill(0)
  out[bin] = 1
  return out
}

/**
 * A smooth bump around `center`: unlike `spike`, two of these are never fully
 * disjoint, so the score between them varies continuously with the distance —
 * which is what a real relief profile does and what a walk can follow.
 */
function bump(center: number, spread = 2): number[] {
  const out = new Array<number>(PROFILE_BINS).fill(0)
  for (let i = 0; i < PROFILE_BINS; i++) out[i] = Math.exp(-((i - center) ** 2) / (2 * spread * spread))
  return out
}

describe('tone fit: score', () => {
  it('is 0 for identical profiles and 1 for disjoint ones', () => {
    expect(toneScore(metrics(spike(3)), metrics(spike(3)))).toBe(0)
    expect(toneScore(metrics(spike(0)), metrics(spike(PROFILE_BINS - 1)))).toBeGreaterThan(0.5)
  })

  it('cares about the height profile, not just the surface shares', () => {
    const low = metrics(spike(1), { topShare: 0.5, slantShare: 0.4, wallShare: 0.1 })
    const high = metrics(spike(14), { topShare: 0.5, slantShare: 0.4, wallShare: 0.1 })
    expect(toneScore(low, high)).toBeGreaterThan(0.3)
  })

  it('counts a moved surface mix as a smaller penalty than a moved profile', () => {
    const shape = { topShare: 0.5, slantShare: 0.4, wallShare: 0.1 }
    const movedShape = { topShare: 0.9, slantShare: 0.05, wallShare: 0.05 }
    const profileOnly = toneScore(metrics(spike(8), shape), metrics(spike(10), shape))
    const sharesOnly = toneScore(metrics(spike(8), shape), metrics(spike(8), movedShape))
    expect(sharesOnly).toBeLessThan(profileOnly)
  })
})

describe('tone fit: search grid', () => {
  it('starts at neutral, so a fit can never be worse than the current tone', () => {
    const first = toneCandidates()[0]
    expect(first).toEqual({ contrast: 1, power: 1 })
  })

  it('starts from the tone in use and never lists it twice', () => {
    const current: ToneCandidate = { contrast: 2, power: 2 }
    const list = toneCandidates(current)
    expect(list[0]).toEqual(current)
    const keys = list.map((c) => `${c.contrast}/${c.power}`)
    expect(new Set(keys).size).toBe(keys.length)
    // 2/2 is also a coarse grid point: it must appear once, as the baseline.
    expect(keys.filter((k) => k === '2/2').length).toBe(1)
  })

  it('keeps every candidate inside the range the sliders allow', () => {
    for (const candidate of toneCandidates()) {
      expect(candidate.contrast).toBeGreaterThanOrEqual(0)
      expect(candidate.contrast).toBeLessThanOrEqual(3)
      expect(candidate.power).toBeGreaterThanOrEqual(0.2)
      expect(candidate.power).toBeLessThanOrEqual(3)
    }
  })

  it('refines around the winner without repeating it', () => {
    const best: ToneCandidate = { contrast: 2, power: 1.5 }
    const ring = refineCandidates(best)
    expect(ring.some((c) => c.contrast === best.contrast && c.power === best.power)).toBe(false)
    expect(ring.some((c) => c.contrast > best.contrast && c.power > best.power)).toBe(true)
    expect(ring.some((c) => c.contrast < best.contrast && c.power < best.power)).toBe(true)
  })

  it('clamps a refined candidate at the edge of the range without duplicating one', () => {
    const ring = refineCandidates({ contrast: 3, power: 0.2 })
    const keys = ring.map((c) => `${c.contrast}/${c.power}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of ring) {
      expect(c.contrast).toBeLessThanOrEqual(3)
      expect(c.power).toBeGreaterThanOrEqual(0.2)
    }
  })
})

describe('tone fit: picking a winner', () => {
  it('takes the lowest score', () => {
    const results: ScoredCandidate[] = [
      { contrast: 1, power: 1, score: 0.4 },
      { contrast: 2, power: 1.5, score: 0.1 },
      { contrast: 3, power: 3, score: 0.2 },
    ]
    expect(pickBest(results)).toMatchObject({ contrast: 2, power: 1.5 })
  })

  it('prefers the setting closest to neutral when the scores tie', () => {
    const results: ScoredCandidate[] = [
      { contrast: 3, power: 3, score: 0.2 },
      { contrast: 1, power: 1, score: 0.2 },
      { contrast: 2, power: 1, score: 0.2 },
    ]
    expect(pickBest(results)).toMatchObject({ contrast: 1, power: 1 })
  })

  it('returns null for an empty result set', () => {
    expect(pickBest([])).toBeNull()
  })
})

describe('tone fit: search over an evaluator', () => {
  const target = metrics(spike(12))

  it('walks past the coarse grid towards the closest setting', () => {
    // The coarse grid is deliberately sparse; the walk has to close the gap.
    // `wanted` sits between grid points on both knobs.
    const wanted: ToneCandidate = { contrast: 1.1, power: 2.2 }
    const seen: ToneCandidate[] = []
    const fit = runToneFit(metrics(bump(0)), (candidate) => {
      seen.push(candidate)
      const distance =
        Math.abs(candidate.contrast - wanted.contrast) + Math.abs(candidate.power - wanted.power)
      // The closer to `wanted`, the closer the profile slides to the target's
      // bin — a score that is monotone in the distance and nothing else.
      const center = Math.max(0, Math.min(PROFILE_BINS - 1, distance * 6))
      return metrics(bump(center))
    })
    expect(fit.improved).toBe(true)
    expect(Math.abs(fit.best.contrast - wanted.contrast)).toBeLessThan(0.3)
    expect(Math.abs(fit.best.power - wanted.power)).toBeLessThan(0.3)
    expect(fit.score).toBeLessThan(fit.baseline)
    // Neutral first (the baseline), then the coarse grid, then the walk.
    expect(seen[0]).toEqual({ contrast: 1, power: 1 })
    expect(seen.length).toBeGreaterThan(toneCandidates().length)
  })

  it('leaves the tone alone when nothing beats the current setting', () => {
    const fit = runToneFit(target, () => metrics(target.heightProfile))
    expect(fit.improved).toBe(false)
    expect(fit.best).toEqual({ contrast: 1, power: 1 })
    expect(fit.score).toBe(fit.baseline)
  })

  it('returns the tone in use untouched when it is already the closest', () => {
    const current: ToneCandidate = { contrast: 2, power: 1.5 }
    const fit = runToneFit(
      target,
      (candidate) =>
        metrics(candidate.contrast === current.contrast && candidate.power === current.power ? target.heightProfile : spike(2)),
      undefined,
      current,
    )
    expect(fit.improved).toBe(false)
    expect(fit.best).toEqual(current)
    expect(fit.score).toBe(fit.baseline)
  })

  it('is stable when clicked twice: the applied tone is kept as a candidate', () => {
    // A fitted value like contrast 130 % is not on the coarse grid; the second
    // click must still be able to keep it instead of drifting to a neighbour.
    const applied: ToneCandidate = { contrast: 1.3, power: 3 }
    const fit = runToneFit(
      target,
      (candidate) =>
        metrics(candidate.contrast === applied.contrast && candidate.power === applied.power ? target.heightProfile : spike(4)),
      undefined,
      applied,
    )
    expect(fit.improved).toBe(false)
    expect(fit.best).toEqual(applied)
  })

  it('reports progress up to the total it announced', () => {
    const reports: Array<[number, number]> = []
    runToneFit(target, () => metrics(spike(5)), (done, total) => reports.push([done, total]))
    expect(reports.length).toBeGreaterThan(1)
    const [lastDone, lastTotal] = reports[reports.length - 1]
    expect(lastDone).toBeLessThanOrEqual(lastTotal)
    for (const [done, total] of reports) expect(done).toBeLessThanOrEqual(total)
  })
})

/** Gray ramp with a soft tonal spread — the kind of picture the tone moves. */
function rampRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Diagonal ramp plus a gentle ripple, so the relief has both slopes and
      // flat runs instead of a single uniform staircase.
      const t = (x / (width - 1)) * 0.7 + (y / (height - 1)) * 0.3
      const v = Math.round(255 * Math.min(1, Math.max(0, t + 0.05 * Math.sin(x / 2))))
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return rgba
}

const WIDTH = 40
const HEIGHT = 40

function options(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
    dither: 0,
    ...overrides,
  }
}

/** One pipeline pass at a given tone, measured with the reference instrument. */
function measureAt(rgba: Uint8ClampedArray, opts: PipelineOptions, tone: ToneCandidate): ReliefMetrics {
  const used: PipelineOptions = { ...opts, contrast: tone.contrast, power: tone.power }
  const q = mapToLuminanceBands(rgba, used.numColors, WIDTH, HEIGHT, used.darkIsTall, 0, {
    contrast: used.contrast,
    power: used.power,
  })
  const result = finishPipeline({ width: WIDTH, height: HEIGHT, rgba: new Uint8ClampedArray(0) }, q, used)
  return measureRelief(result.mesh.positions, result.mesh.triangleCount, {
    gridStepX: used.widthMm / WIDTH,
    gridStepY: used.heightMm / HEIGHT,
  })
}

describe('tone fit: against a reference relief', () => {
  const rgba = rampRgba(WIDTH, HEIGHT)

  it('recovers the tone a reference relief was built with', () => {
    // The reference here is our own relief at a known setting: the fit has to
    // find it again from the measured profile alone.
    const target = measureAt(rgba, options(), { contrast: 2, power: 1 })
    const fit = runFitToneTask({
      type: 'fit-tone',
      id: 1,
      rgba,
      width: WIDTH,
      height: HEIGHT,
      opts: options(),
      target,
    })
    expect(fit.improved).toBe(true)
    expect(fit.best.contrast).toBeGreaterThan(1)
    expect(fit.score).toBeLessThan(fit.baseline)
  })

  it('leaves the tone neutral when the reference already matches it', () => {
    const target = measureAt(rgba, options(), { contrast: 1, power: 1 })
    const fit = runFitToneTask({
      type: 'fit-tone',
      id: 2,
      rgba,
      width: WIDTH,
      height: HEIGHT,
      opts: options(),
      target,
    })
    expect(fit.improved).toBe(false)
    expect(fit.best).toEqual({ contrast: 1, power: 1 })
  })

  it('compares profiles across print sizes, so a small reference still fits', () => {
    // A HueForge reference is a few millimetres tall with 0.08 mm layers while
    // our print is centimetres tall with 0.2 mm layers: the fit compares the
    // *shape* of the height distribution, not the millimetres.
    const small = measureAt(rgba, options({ maxHeightMm: 4, layerMm: 0.1 }), { contrast: 2, power: 1 })
    const large = measureAt(rgba, options({ maxHeightMm: 12, layerMm: 0.2 }), { contrast: 2, power: 1 })
    const otherTone = measureAt(rgba, options({ maxHeightMm: 12, layerMm: 0.2 }), { contrast: 1, power: 2 })
    const sameTone = profileDistance(small.heightProfile, large.heightProfile)
    const differentTone = profileDistance(small.heightProfile, otherTone.heightProfile)
    expect(sameTone).toBeLessThan(differentTone)
    expect(sameTone).toBeLessThan(0.15)
  })

  it('keeps the worker’s ΔE merge report untouched', () => {
    // A fit runs the merge internally, and the merge writes the worker's
    // kept-slot report. That report describes the *stored* quantize, so a fit
    // must not leave its own behind: the next rebuild would otherwise remap
    // the caller's filament assignments through the wrong palette.
    //
    // The stored quantize is given near-identical spool colors (the palette
    // override path), so it really does merge; the fit runs on the picture's
    // own well-separated tones, so its internal runs do not merge at all. A
    // leaked report is therefore observable as a missing one.
    const nearDuplicates = [100, 104, 108, 112].map((v) => ({ r: v, g: v, b: v }))
    const mergeOpts = options({ mergeDeltaE: 20 })
    resetWorkerState()
    const stored = runWorkerTask({
      type: 'quantize',
      id: 1,
      rgba,
      width: WIDTH,
      height: HEIGHT,
      opts: { ...mergeOpts },
      paletteOverride: nearDuplicates,
      // The quantize task takes the threshold at the top level; the fit reads
      // it from `opts` (the same value the editor passes to both).
      mergeDeltaE: mergeOpts.mergeDeltaE,
    })
    expect(stored.mergeKept).toBeDefined()
    expect(stored.mergeKept!.length).toBeLessThan(nearDuplicates.length)

    const target = measureAt(rgba, options(), { contrast: 2, power: 1 })
    runFitToneTask({
      type: 'fit-tone',
      id: 2,
      rgba,
      width: WIDTH,
      height: HEIGHT,
      opts: { ...mergeOpts },
      target,
    })

    const rebuilt = runWorkerTask({
      type: 'finish',
      id: 3,
      opts: { ...mergeOpts },
      palette: stored.palette.map((p) => ({ ...p.color })),
    })
    expect(rebuilt.mergeKept).toEqual(stored.mergeKept)
    resetWorkerState()
  })
})
