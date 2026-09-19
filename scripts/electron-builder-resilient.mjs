/**
 * electron-builder wrapper that survives the Windows Defender EPERM.
 *
 * Defender's real-time scan holds kernel handles on freshly unpacked files
 * (~200 MB of Electron), so electron-builder's `win-unpacked.tmp ->
 * win-unpacked` rename intermittently fails with EPERM even though no
 * user-mode process holds the directory (Restart Manager shows no lockers).
 *
 * Recovery strategy (proven in the v0.8.3-rc.4 release):
 *   1. retry the same build up to N times — the scan usually finishes in
 *      tens of seconds, so a later attempt can rename freely;
 *   2. each retry after the first uses a fresh output directory
 *      (`-c.directories.output=<out>-retry-<n>`), because a half-renamed
 *      `.tmp` directory from the failed attempt keeps the original output
 *      poisoned;
 *   3. if a retry succeeds in an alternate directory, artifacts are moved
 *      back to the configured output directory so callers (and humans)
 *      always find setup exe / latest.yml where the config promises.
 *
 * All electron-builder CLI arguments are passed through unchanged.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const MAX_ATTEMPTS = 3
const EPERM_HINTS = [
  'EPERM: operation not permitted',
  // Electron unpack is the only rename of a `.tmp` dir in the pipeline.
  /rename '.*win-unpacked\.tmp'/,
]

function outputDirOf(args) {
  const flagIdx = args.indexOf('-c.directories.output')
  if (flagIdx !== -1) return args[flagIdx + 1]
  const eqArg = args.find(a => a.startsWith('-c.directories.output='))
  if (eqArg) return eqArg.slice('-c.directories.output='.length)
  // Fall back to electron-builder's default / package.json directories.output.
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return pkg?.build?.directories?.output ?? 'release'
  } catch {
    return 'release'
  }
}

/**
 * Strip `-c.directories.output` from the argument list — used on retry, where
 * the wrapper appends its own `=...` form. Both the `=value` and the
 * space-separated form must go, otherwise the orphaned value would be read by
 * electron-builder as a positional build path.
 */
function withoutOutputDir(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-c.directories.output' || arg === '--config.directories.output') {
      i++ // also drop the value that follows
      continue
    }
    if (arg.startsWith('-c.directories.output=') || arg.startsWith('--config.directories.output=')) continue
    out.push(arg)
  }
  return out
}

function looksLikeDefenderEperm(output) {
  return EPERM_HINTS.some(h => (h instanceof RegExp ? h.test(output) : output.includes(h)))
}

function isActualBuildFailure(output) {
  // "building block map" is the last step; if it printed, the build finished
  // and a non-zero code came from something else (e.g. signing warnings).
  return !/building block map/.test(output)
}

const passthroughArgs = process.argv.slice(2)
const baseOut = outputDirOf(passthroughArgs)
let lastOutput = ''

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const out = attempt === 1 ? baseOut : `${baseOut}-retry-${attempt}`
  const args = attempt === 1 ? passthroughArgs : withoutOutputDir(passthroughArgs)
  const argv = attempt === 1 ? args : [...args, `-c.directories.output=${out}`]

  console.log(`\n[builder-resilient] attempt ${attempt}/${MAX_ATTEMPTS} (output: ${out})`)
  const res = spawnSync('npx', ['electron-builder', ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    encoding: 'utf8',
  })
  lastOutput = (res.stdout ?? '') + (res.stderr ?? '')
  process.stdout.write(lastOutput)

  if (res.status === 0) {
    if (attempt > 1 && out !== baseOut && existsSync(join(out, 'win-unpacked'))) {
      // Relocate artifacts so the configured output dir stays canonical.
      mkdirSync(baseOut, { recursive: true })
      for (const name of readdirSync(out)) {
        const from = join(out, name)
        const to = join(baseOut, name)
        try {
          renameSync(from, to)
        } catch {
          console.warn(`[builder-resilient] could not move ${name} — artifacts remain in ${out}`)
        }
      }
      console.log(`[builder-resilient] artifacts relocated: ${out} -> ${baseOut}`)
    }
    process.exit(0)
  }

  if (!looksLikeDefenderEperm(lastOutput) || !isActualBuildFailure(lastOutput)) {
    console.error('[builder-resilient] failure is not the Defender EPERM pattern — not retrying')
    process.exit(res.status ?? 1)
  }
  console.warn(`[builder-resilient] Defender EPERM hit (attempt ${attempt}) — backing off 20s before retry`)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000)
}

console.error(`[builder-resilient] all ${MAX_ATTEMPTS} attempts failed`)
process.exit(1)
