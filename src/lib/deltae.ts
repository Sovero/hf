/**
 * CIE color science for the ΔE error map: sRGB → Lab (D65) and the
 * CIEDE2000 color-difference formula (Sharma, Wu & Dalal 2005). Pure math,
 * no DOM — testable in Node against the published reference vectors.
 */

/** sRGB (0..255 per channel) → CIE L*a*b* (D65 illuminant). */
export function srgbToLab(r255: number, g255: number, b255: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const r = lin(r255)
  const g = lin(g255)
  const b = lin(b255)
  // sRGB → XYZ (D65), normalized by the white point so Lab comes out right.
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/**
 * CIEDE2000 color difference between two L*a*b* colors (kL = kC = kH = 1).
 * Reference: Sharma, Wu, Dalal, "The CIEDE2000 Color-Difference Formula:
 * Implementation Notes", Color Res. Appl. 30 (2005) 21–30.
 */
export function deltaE2000(
  l1: number,
  a1: number,
  b1: number,
  l2: number,
  a2: number,
  b2: number,
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const deg = (r: number) => (r * 180) / Math.PI
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  let h1p = deg(Math.atan2(b1, a1p))
  if (h1p < 0) h1p += 360
  let h2p = deg(Math.atan2(b2, a2p))
  if (h2p < 0) h2p += 360

  const dLp = l2 - l1
  const dCp = C2p - C1p
  let dhp: number
  if (C1p * C2p === 0) {
    dhp = 0
  } else {
    const d = h2p - h1p
    dhp = Math.abs(d) <= 180 ? d : d > 180 ? d - 360 : d + 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2)

  const Lbar = (l1 + l2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbar: number
  if (C1p * C2p === 0) {
    hbar = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbar = (h1p + h2p) / 2
  } else if (h1p + h2p < 360) {
    hbar = (h1p + h2p + 360) / 2
  } else {
    hbar = (h1p + h2p - 360) / 2
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbar - 30)) +
    0.24 * Math.cos(rad(2 * hbar)) +
    0.32 * Math.cos(rad(3 * hbar + 6)) -
    0.2 * Math.cos(rad(4 * hbar - 63))
  const dTheta = 30 * Math.exp(-Math.pow((hbar - 275) / 25, 2))
  const Cbarp7 = Math.pow(Cbarp, 7)
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)))
  const L50 = Lbar - 50
  const SL = 1 + (0.015 * L50 * L50) / Math.sqrt(20 + L50 * L50)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(rad(2 * dTheta)) * RC

  const dL = dLp / SL
  const dC = dCp / SC
  const dH = dHp / SH
  return Math.sqrt(dL * dL + dC * dC + dH * dH + RT * dC * dH)
}

/** ΔE2000 between two sRGB colors (0..255). Convenience for the heatmap. */
export function deltaE2000Rgb(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [l1, a1, bb1] = srgbToLab(r1, g1, b1)
  const [l2, a2, bb2] = srgbToLab(r2, g2, b2)
  return deltaE2000(l1, a1, bb1, l2, a2, bb2)
}