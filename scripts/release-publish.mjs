/**
 * Publishes the release for the version in package.json to GitHub releases,
 * with the channel flags derived from the tag itself.
 *
 * Why this exists: an RC published without `--prerelease` becomes
 * `releases/latest`, and the desktop app (allowPrerelease = false) resolves
 * exactly that endpoint — so every stable install would be offered the
 * candidate. That happened once with v0.8.3-rc.4, and the publish step was a
 * manual `gh release edit` that had to remember the flag.
 *
 * What it does:
 *   1. checks the tag exists (locally and on the remote), matches package.json
 *      and carries the same version inside the tagged tree;
 *   2. checks the built artifacts in release/ — setup exe, blockmap and
 *      latest.yml — and that latest.yml really describes that exe (sha512);
 *   3. publishes (or promotes an existing draft) with `--prerelease` for a
 *      semver pre-release and `--latest` for a stable tag;
 *   4. uploads the three artifacts;
 *   5. verifies the result: release flags, asset sizes, the published
 *      latest.yml, and the stable channel — failing if `releases/latest`
 *      points at a pre-release.
 *
 * Usage:
 *   npm run release:publish                       # publishes v<package.json version>
 *   npm run release:publish -- --version 0.8.3    # a specific version
 *   npm run release:publish -- --notes FILE       # notes for a release that does not exist yet
 *   npm run release:publish -- --dry-run          # print the mutations, change nothing
 *
 * HF_GH_BIN overrides the `gh` binary (default: `gh`); pointing it at a
 * `.mjs`/`.cjs` file runs that file with the current Node binary, which is how
 * the channel guards are exercised against a stub.
 *
 * Publishing a draft for review first still works: create it with
 * `gh release create <tag> --draft`, then run this script to publish it.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactDir = join(root, 'release')

const argv = process.argv.slice(2)
const has = name => argv.includes(`--${name}`)
const valueOf = name => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const DRY_RUN = has('dry-run')
const NOTES_FILE = valueOf('notes')
const GH_BIN = process.env.HF_GH_BIN

/** `gh` invocation, honouring the test/wrapper override. */
const ghInvocation = args =>
  GH_BIN ? { file: process.execPath, args: [GH_BIN, ...args] } : { file: 'gh', args }

const done = []
const warn = message => console.log(`! ${message}`)
const step = message => console.log(`\n▸ ${message}`)

class PublishError extends Error {}

function fail(message, fix) {
  throw new PublishError(fix ? `${message}\n\n  Как поправить: ${fix}` : message)
}

/** Read-only command calls. */
function read(file, args) {
  return execFileSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

/** Mutating gh calls — printed instead of executed under --dry-run. */
function mutate(args) {
  const { file, args: argv } = ghInvocation(args)
  if (DRY_RUN) {
    console.log(`  [dry-run] gh ${args.join(' ')}`)
    return ''
  }
  return execFileSync(file, argv, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

/** Read-only gh calls. */
const gh = (...args) => {
  const { file, args: argv } = ghInvocation(args)
  return read(file, argv)
}

const ghJson = args => JSON.parse(gh(...args))

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Pre-release identifier of a semver string, or null for a stable version. */
function prereleaseOf(version) {
  const match = SEMVER.exec(version)
  if (!match) return undefined
  return match[4] ?? null
}

// ---------------------------------------------------------------------------
// 1. Version, tag and artifacts
// ---------------------------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Target of this run: version, tag, channel and the artifacts that go with it. */
let version = ''
let tag = ''
let isPrerelease = false
let artifacts = []

function resolveTarget() {
  version = valueOf('version') ?? pkg.version
  tag = `v${version}`

  const prerelease = prereleaseOf(version)
  if (prerelease === undefined) {
    fail(`версия «${version}» не является semver — тег и канал из неё не вывести`)
  }
  isPrerelease = prerelease !== null

  artifacts = [
    `hueforge-desktop-setup-${version}.exe`,
    `hueforge-desktop-setup-${version}.exe.blockmap`,
    'latest.yml',
  ]

  step(`Релиз ${tag} · ${isPrerelease ? `pre-release (${prerelease})` : 'стабильный канал (Latest)'}`)
}

// ---------------------------------------------------------------------------
// 2. Preflight
// ---------------------------------------------------------------------------

function preflight() {
  // Tag must exist on the remote — the release is attached to it.
  const remote = read('git', ['ls-remote', '--tags', 'origin', tag])
  if (!remote) fail(`тег ${tag} не найден на origin`, `git push origin ${tag}`)
  const tagCommit = remote.split(/\s+/)[0]

  // The tagged tree, not the working tree, is what the artifacts were built
  // from; a mismatch means the exe does not belong to this tag.
  const taggedVersion = JSON.parse(read('git', ['show', `${tag}:package.json`])).version
  if (taggedVersion !== version) {
    fail(
      `в коммите тега ${tag} версия ${taggedVersion}, а публикуется ${version}`,
      `пересоберите тег на коммите с версией ${version}`,
    )
  }

  const localHead = read('git', ['rev-parse', 'HEAD'])
  if (localHead !== tagCommit) {
    warn(`HEAD (${localHead.slice(0, 7)}) не совпадает с тегом ${tag} (${tagCommit.slice(0, 7)})`)
  }

  console.log(`  тег: ${tag} → ${tagCommit.slice(0, 7)}`)

  for (const name of artifacts) {
    if (!existsSync(join(artifactDir, name))) {
      fail(
        `нет артефакта release/${name}`,
        'соберите дистрибутив: npm run dist',
      )
    }
  }

  // latest.yml is what the updater reads: it must describe the exe we upload.
  const manifest = readFileSync(join(artifactDir, 'latest.yml'), 'utf8')
  const ymlVersion = /^version:\s*(.+)$/m.exec(manifest)?.[1].trim()
  if (ymlVersion !== version) {
    fail(
      `latest.yml описывает версию ${ymlVersion}, а публикуется ${version}`,
      'пересоберите дистрибутив: npm run dist',
    )
  }

  const exe = join(artifactDir, artifacts[0])
  const exeDir = artifacts[0]
  const expectedHash = /^sha512:\s*(.+)$/m.exec(manifest)?.[1].trim()
  const actualHash = createHash('sha512').update(readFileSync(exe)).digest('base64')
  const exeSize = statSync(exe).size

  if (expectedHash !== actualHash) {
    fail(
      `sha512 в latest.yml не совпадает с ${exeDir} — автообновление отклонит загрузку`,
      'пересоберите дистрибутив: npm run dist',
    )
  }

  console.log(`  артефакты: ${artifacts.length} файла, exe ${exeSize} Б, sha512 сверен`)
  return exeSize
}

// ---------------------------------------------------------------------------
// 3. Publish, upload, verify
// ---------------------------------------------------------------------------

function releaseExists() {
  try {
    gh('release', 'view', tag, '--json', 'tagName')
    return true
  } catch {
    return false
  }
}

function publish(notesFile) {
  const flags = isPrerelease ? ['--prerelease'] : ['--prerelease=false', '--latest']

  if (releaseExists()) {
    console.log(`  релиз ${tag} уже есть — обновляю флаги и ассеты`)
    mutate(['release', 'edit', tag, '--draft=false', ...flags])
    return
  }

  if (notesFile) {
    if (!existsSync(notesFile)) fail(`файл с нотами не найден: ${notesFile}`)
    mutate(['release', 'create', tag, '--title', `HueForge ${tag}`, '--notes-file', notesFile, '--verify-tag', ...flags])
  } else {
    warn('ноты не переданы (--notes FILE) — GitHub сгенерирует их из коммитов')
    mutate(['release', 'create', tag, '--title', `HueForge ${tag}`, '--generate-notes', '--verify-tag', ...flags])
  }
}

function verifyChannel(exeSize) {
  const info = ghJson(['release', 'view', tag, '--json', 'isDraft,isPrerelease,assets'])

  if (info.isDraft) fail(`релиз ${tag} остался черновиком`, `gh release edit ${tag} --draft=false`)
  if (info.isPrerelease !== isPrerelease) {
    fail(
      `флаг pre-release у ${tag} = ${info.isPrerelease}, ожидался ${isPrerelease}`,
      `gh release edit ${tag} ${isPrerelease ? '--prerelease' : '--prerelease=false'}`,
    )
  }

  const byName = new Map(info.assets.map(a => [a.name, a.size]))
  const missing = artifacts.filter(name => !byName.has(name))
  if (missing.length > 0) fail(`в релизе нет ассетов: ${missing.join(', ')}`)

  if (byName.get(artifacts[0]) !== exeSize) {
    fail(
      `ассет ${artifacts[0]} другого размера (${byName.get(artifacts[0])} вместо ${exeSize}) — загрузка не завершилась`,
      `gh release upload ${tag} release/${artifacts[0]} --clobber`,
    )
  }
  console.log(`  ассеты на релизе: ${artifacts.length}, размер exe совпадает`)

  // The updater's own path: fetch latest.yml back and compare it with the build.
  const temp = mkdtempSync(join(tmpdir(), 'release-publish-'))
  try {
    gh('release', 'download', tag, '--pattern', 'latest.yml', '--output', join(temp, 'latest.yml'), '--clobber')
    const published = readFileSync(join(temp, 'latest.yml'), 'utf8')
    const publishedHash = /^sha512:\s*(.+)$/m.exec(published)?.[1].trim()
    const localHash = /^sha512:\s*(.+)$/m.exec(readFileSync(join(artifactDir, 'latest.yml'), 'utf8'))?.[1].trim()
    if (publishedHash !== localHash) fail('latest.yml в релизе отличается от собранного')
    console.log('  latest.yml в релизе совпадает с собранным')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }

  // The invariant this whole script exists for: `releases/latest` — the only
  // endpoint the shipped app asks — must never point at a candidate.
  const latest = ghJson(['api', 'repos/{owner}/{repo}/releases/latest', '--jq', '{tag: .tag_name, prerelease: .prerelease}'])
  if (latest.prerelease) {
    const fixes = [`gh release edit ${latest.tag} --prerelease`]
    // A stable publish also has to claim the label back from the candidate.
    if (!isPrerelease) fixes.push(`gh release edit ${tag} --latest`)
    fail(
      `стабильный канал указывает на pre-release ${latest.tag} — все стабильные установки получат кандидата`,
      fixes.join(' && '),
    )
  }
  if (!isPrerelease && latest.tag !== tag) {
    fail(
      `стабильный канал остался на ${latest.tag}, а опубликован ${tag}`,
      `gh release edit ${tag} --latest`,
    )
  }

  console.log(`  стабильный канал: ${latest.tag}${isPrerelease ? ` (кандидат ${tag} его не перехватил)` : ' = опубликованный релиз'}`)
}

function main() {
  resolveTarget()
  const exeSize = preflight()
  step('Публикация')
  publish(NOTES_FILE)
  done.push('флаги канала выставлены по тегу')

  if (!DRY_RUN) {
    step('Загрузка артефактов')
    mutate(['release', 'upload', tag, ...artifacts.map(name => join('release', name)), '--clobber'])
    done.push(`загружено ${artifacts.length} артефакта`)

    step('Проверка канала')
    verifyChannel(exeSize)
    done.push('канал и артефакты сверены')
  }

  const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner')
  console.log(`\nГотово: https://github.com/${repo}/releases/tag/${tag}`)
  for (const item of done) console.log(`  ✓ ${item}`)
  if (!isPrerelease) console.log('  ✓ RC-установки получат эту версию по semver')
  console.log('\nДальше: npm run changelog:sync — перенести ноты релиза в CHANGELOG.md.')
}

try {
  main()
} catch (error) {
  if (error instanceof PublishError) {
    console.error(`\n✗ ${error.message}`)
    process.exit(1)
  }
  throw error
}
