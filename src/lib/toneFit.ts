import { profileDistance, type ReliefMetrics } from './reliefCompare'
import { TONE_CONTRAST_MAX, TONE_CONTRAST_MIN, TONE_POWER_MAX, TONE_POWER_MIN } from './quantize'

/**
 * Fit the relief tone stage (relief contrast + detail deepening) to a
 * reference relief.
 *
 * The reference — an STL exported by HueForge, a slicer, or this app — is
 * measured with the same instrument as our own mesh (`measureRelief`), and the
 * fit searches the two tone knobs for the setting whose surface comes closest
 * to the reference's.
 *
 * What makes the two comparable is the **height profile**: how the upward
 * surface distributes across the relief's own height range. Footprint, grid
 * pitch, layer step and total height are all set by other controls, but where
 * the picture puts its mass — dark and bottom-heavy or light and top-heavy,
 * with soft or steep tonal ramps — is exactly what contrast and detail
 * deepening move.
 *
 * Everything here is pure: the search takes an `evaluate` callback instead of
 * running the pipeline itself, so the orchestration is unit-testable with a
 * synthetic evaluator and runs unchanged inside the pipeline worker.
 */

/** One candidate setting of the tone stage, in multiplier form (1 = neutral). */
export interface ToneCandidate {
  contrast: number
  power: number
}

const NEUTRAL: ToneCandidate = { contrast: 1, power: 1 }

/**
 * Weight of the height profile in the score; the rest is the mix of surface
 * forms (flat plateaus / slanted transitions / walls). The profile leads
 * because it is what the tone knobs shape, while the shares only react to it.
 */
const PROFILE_WEIGHT = 0.75

/**
 * Coarse grid: three positions per knob — below the picture's own tone, above
 * it, and at the top of the dial. The greedy walk fills in between, so the grid
 * only has to seed a basin, not cover the dial.
 */
const COARSE_CONTRAST = [0.5, 1.5, 3]
const COARSE_POWER = [0.5, 1.5, 3]

/**
 * Step of the fine ring around the walked winner — 10 %, the step the contrast
 * and Detail sliders themselves use, so every value the search picks is a value
 * the UI can hold: a finer step would only be rounded away when the winner is
 * written into the sliders.
 */
const REFINE_STEP = 0.1

/** Step of the greedy walk that follows the coarse grid. */
const WALK_STEP = 0.25

/** Rounds of the walk, and the pipeline runs it may spend in total. */
const WALK_ROUNDS = 6
const WALK_BUDGET = 16

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * How far our relief is from the reference, 0 (identical) … 1 (nothing in
 * common). The height profile dominates; the share of surface forms refines
 * the tie, because a relief can carry the same tonal mass with more or less of
 * it spent on flat plateaus.
 */
export function toneScore(reference: ReliefMetrics, own: ReliefMetrics): number {
  const profile = profileDistance(reference.heightProfile, own.heightProfile)
  const shares =
    (Math.abs(reference.topShare - own.topShare) +
      Math.abs(reference.slantShare - own.slantShare) +
      Math.abs(reference.wallShare - own.wallShare)) /
    2
  return PROFILE_WEIGHT * profile + (1 - PROFILE_WEIGHT) * Math.min(1, shares)
}

/**
 * The coarse grid the search starts from. The setting the user already has
 * (`baseline`, neutral by default) comes first, so a fit can never do worse
 * than it and a second click on an already-fitted tone has nothing to beat.
 * The grid itself is deliberately small: the greedy walk in `runToneFit`
 * explores everything between its points.
 */
export function toneCandidates(baseline: ToneCandidate = NEUTRAL): ToneCandidate[] {
  const list: ToneCandidate[] = [{ ...baseline }]
  const seen = new Set([`${baseline.contrast}/${baseline.power}`])
  for (const contrast of COARSE_CONTRAST) {
    for (const power of COARSE_POWER) {
      const key = `${contrast}/${power}`
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ contrast, power })
    }
  }
  return list
}

/** Eight neighbours of the coarse winner, one step out in every direction. */
export function refineCandidates(best: ToneCandidate, step = REFINE_STEP): ToneCandidate[] {
  const out: ToneCandidate[] = []
  for (const dc of [-step, 0, step]) {
    for (const dp of [-step, 0, step]) {
      if (dc === 0 && dp === 0) continue
      out.push({
        contrast: round2(clamp(best.contrast + dc, TONE_CONTRAST_MIN, TONE_CONTRAST_MAX)),
        power: round2(clamp(best.power + dp, TONE_POWER_MIN, TONE_POWER_MAX)),
      })
    }
  }
  // Duplicates appear at the range edges, and a candidate equal to the winner
  // would only be re-measured.
  const seen = new Set([`${best.contrast}/${best.power}`])
  return out.filter((c) => {
    const key = `${c.contrast}/${c.power}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface ScoredCandidate extends ToneCandidate {
  score: number
}

/**
 * Lowest score wins; ties go to the candidate closest to the setting the user
 * already had (`baseline`), so the search never invents a stronger tone for
 * the same result. `epsilon` absorbs the float noise of the score.
 */
export function pickBest(
  results: ScoredCandidate[],
  baseline: ToneCandidate = NEUTRAL,
): ScoredCandidate | null {
  const epsilon = 1e-9
  const distanceFromBaseline = (c: ToneCandidate) =>
    Math.abs(c.contrast - baseline.contrast) + Math.abs(c.power - baseline.power)
  let best: ScoredCandidate | null = null
  for (const candidate of results) {
    if (!best) {
      best = candidate
      continue
    }
    if (candidate.score < best.score - epsilon) {
      best = candidate
    } else if (Math.abs(candidate.score - best.score) <= epsilon && distanceFromBaseline(candidate) < distanceFromBaseline(best)) {
      best = candidate
    }
  }
  return best
}

export interface ToneFitResult {
  /** The setting to apply (the current one when nothing beat it). */
  best: ToneCandidate
  /** Score of `best`, 0…1, lower is closer to the reference. */
  score: number
  /** Score of the tone already in use — the number the fit had to beat. */
  baseline: number
  /** Settings evaluated, including the neutral baseline. */
  evaluations: number
  /** False when the reference was already matched best by the current tone. */
  improved: boolean
}

/**
 * Search the two tone knobs for the setting whose relief comes closest to
 * `target`. Coarse grid first, then one refinement ring around the winner — a
 * few dozen pipeline runs, which is what keeps the fit usable on a real image.
 *
 * `evaluate` measures our relief at a candidate setting; `onProgress` reports
 * how far along the search is (the UI shows it while the worker grinds).
 *
 * `current` is the tone the sliders hold right now: it is measured first, kept
 * as one of the candidates and returned unchanged when nothing beats it — so a
 * second click on an already-fitted tone is a no-op instead of a small drift.
 */
export function runToneFit(
  target: ReliefMetrics,
  evaluate: (candidate: ToneCandidate) => ReliefMetrics,
  onProgress?: (done: number, total: number) => void,
  /** The tone in use now — the number to beat. Defaults to neutral (100 %). */
  current: ToneCandidate = NEUTRAL,
): ToneFitResult {
  const coarse = toneCandidates(current)
  const budget = coarse.length + WALK_BUDGET + 8
  const scored: ScoredCandidate[] = []
  const measured = new Set<string>()
  const key = (c: ToneCandidate) => `${c.contrast}/${c.power}`
  const measure = (candidate: ToneCandidate): ScoredCandidate => {
    measured.add(key(candidate))
    const score = toneScore(target, evaluate(candidate))
    const entry: ScoredCandidate = { ...candidate, score }
    scored.push(entry)
    onProgress?.(scored.length, budget)
    return entry
  }
  /** Neighbours of `from` the UI can hold, at `step`, skipping measured ones. */
  const fresh = (from: ToneCandidate, step: number) =>
    refineCandidates(from, step).filter((c) => !measured.has(key(c)))

  for (const candidate of coarse) measure(candidate)
  const baselineScore = scored[0]?.score ?? 1

  let best = pickBest(scored, current) ?? { ...current, score: baselineScore }

  // Greedy walk. The coarse grid cannot cover the whole dial — its winner
  // often sits short of the optimum (150 % when 110 % is the closest) — so the
  // search keeps stepping the knob that helps, wasting no run: only moves that
  // score better are taken, so the walk cannot end up worse than the coarse
  // winner. One axis at a time first (4 runs), diagonals only when no single
  // knob helps (4 more); without this, every extra click of the button would
  // move the tone by one step instead of the first click finding the optimum.
  let spent = 0
  const walk = (candidates: ToneCandidate[]): ScoredCandidate | null => {
    let roundBest: ScoredCandidate | null = null
    for (const candidate of candidates) {
      if (spent >= WALK_BUDGET) break
      spent++
      const entry = measure(candidate)
      if (!roundBest || entry.score < roundBest.score - 1e-9) roundBest = entry
    }
    return roundBest && roundBest.score < best.score - 1e-9 ? roundBest : null
  }
  for (let round = 0; round < WALK_ROUNDS && spent < WALK_BUDGET; round++) {
    const step = WALK_STEP
    const axis = fresh(best, step).filter(
      (c) => c.contrast === best.contrast || c.power === best.power,
    )
    const diagonal = fresh(best, step).filter(
      (c) => c.contrast !== best.contrast && c.power !== best.power,
    )
    const next = walk(axis) ?? walk(diagonal)
    if (!next) break
    best = next
  }

  // Fine ring at the UI's own step, so the value handed to the sliders is the
  // best the search can actually represent.
  for (const candidate of fresh(best, REFINE_STEP)) measure(candidate)

  const winner = pickBest(scored, current) ?? { ...current, score: baselineScore }
  const improved =
    winner.score < baselineScore - 1e-9 &&
    (winner.contrast !== current.contrast || winner.power !== current.power)
  return {
    best: improved ? { contrast: winner.contrast, power: winner.power } : { ...current },
    score: improved ? winner.score : baselineScore,
    baseline: baselineScore,
    evaluations: scored.length,
    improved,
  }
}
