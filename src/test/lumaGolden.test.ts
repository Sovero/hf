import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resetWorkerState, runWorkerTask } from '../lib/workerProtocol'
import type { PipelineOptions } from '../lib/pipeline'

/**
 * Golden hashes of the brightness / colors-first pipeline.
 *
 * The depth-relief feature threads an optional field through the quantize step;
 * without the field the output must stay byte-for-byte what it was. These
 * hashes were taken from code verified identical to the pre-depth commit over a
 * 256-case grid, so a change here means the ordinary print changed — either a
 * deliberate pipeline change (regenerate the hashes on purpose) or a regression.
 */

function image(w: number, h: number, seed: number): Uint8ClampedArray {
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = Math.sin(x / 3 + seed) * 0.5 + 0.5
      const b = Math.cos(y / 4 - seed) * 0.5 + 0.5
      px[i] = Math.round(255 * (0.6 * a + 0.4 * rnd()))
      px[i + 1] = Math.round(255 * (0.5 * b + 0.3 * a + 0.2 * rnd()))
      px[i + 2] = Math.round(255 * (0.7 * (1 - a) * b + 0.3 * rnd()))
      px[i + 3] = 255
    }
  }
  return px
}

function hashOf(opts: Partial<PipelineOptions>, seed: number): string {
  resetWorkerState()
  const w = 24
  const h = 20
  const result = runWorkerTask({
    type: 'quantize',
    id: 1,
    rgba: image(w, h, seed),
    width: w,
    height: h,
    mergeDeltaE: opts.mergeDeltaE,
    opts: {
      numColors: 4,
      darkIsTall: true,
      widthMm: 40,
      heightMm: 34,
      baseMm: 0.8,
      maxHeightMm: 8,
      layerMm: 0.2,
      ...opts,
    },
  })
  const text = JSON.stringify(result, (_k, v) =>
    ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v,
  )
  return createHash('sha256').update(text).digest('hex')
}

describe('brightness pipeline golden output (no depth field)', () => {
  it('brightness bands, dark tall, dither + smooth + tone', () => {
    expect(hashOf({ colorMode: 'luma', numColors: 4, dither: 0.6, smooth: 0.5, contrast: 1.5, power: 1.4 }, 1)).toBe(
      '105798c65bf02a90bcddd778b9f2ccf651de60affce41eb2229c41b69c0a823e',
    )
  })

  it('brightness bands, light tall, ΔE merge', () => {
    expect(hashOf({ colorMode: 'luma', numColors: 6, darkIsTall: false, mergeDeltaE: 12 }, 2)).toBe('d61d1379e5c17497018dc2e27de927b6e2fc20e024c172043c893eea29533428')
  })

  it('colors-first model', () => {
    expect(hashOf({ colorMode: 'image', numColors: 6, darkIsTall: true }, 1)).toBe('52ee2a9daaa554d06784f66c6877010381657c481b773de60f18cd0624740a2e')
  })
})
