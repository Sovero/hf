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
 *   2. checks that the tagged tree's CHANGELOG.md carries the version — the
 *      entry is synced *before* the tag (`npm run release:prepare`), so a tag
 *      without it means the release describes a version the changelog of that
 *      tree does not mention;
 *   3. checks the built artifacts in release/ — setup exe, blockmap and
 *      latest.yml — and that latest.yml really describes that exe (sha512);
 *   4. publishes (or promotes an existing draft) with `--prerelease` for a
 *      semver pre-release and `--latest` for a stable tag, and with the
 *      repository's notes (`release-notes/<tag>.md`) as the release body — so
 *      the release page and the changelog entry say the same thing instead of
 *      GitHub's auto-generated notes contradicting the tagged CHANGELOG;
 *   5. uploads the three artifacts when they are a local build; a tag pushed for
 *      CI to build has them on the draft already, and then the release itself is
 *      the source that gets verified;
 *   6. verifies the result: release flags, asset sizes, the published
 *      latest.yml and body, and the stable channel — failing if
 *      `releases/latest` points at a pre-release.
 *
 * Usage:
 *   npm run release:publish                       # publishes v<package.json version>
 *   npm run release:publish -- --version 0.8.3    # a specific version
 *   npm run release:publish -- --notes FILE       # notes from somewhere other than release-notes/
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
import { DRAFT_MARKER } from './sync-changelog.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactDir = join(root, 'release')
const CHANGELOG = 'CHANGELOG.md'

const argv = process.argv.slice(2)
const has = name => argv.includes(`--${name}`)
const valueOf = name => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const DRY_RUN = has('dry-run')
const NOTES_FILE = valueOf('notes')
const GH_BIN = process.env.HF_GH_BIN

/** Body of the release: an explicit `--notes`, or what the repository wrote for this tag. */
function notesFor(tag) {
  const file = NOTES_FILE ?? join('release-notes', `${tag}.md`)
  if (!existsSync(file)) {
    if (NOTES_FILE) fail(`файл с нотами не найден: ${NOTES_FILE}`)
    return null
  }

  // A draft `release:prepare` assembled from commit subjects is not a release
  // body — publishing it would put "черновик" on the release page.
  if (readFileSync(file, 'utf8').includes(DRAFT_MARKER)) {
    fail(
      `${file} всё ещё черновик — его разделы собраны из коммитов, а не написаны`,
      `отредактируйте ${file} и уберите строку, начинающуюся с «Черновик нот», затем повторите публикацию`,
    )
  }
  return file
}

/**
 * GitHub normalises a body enough that a byte compare would lie (line endings,
 * trailing whitespace), so the comparison is on trimmed lines.
 */
function sameText(left, right) {
  const normalize = text =>
    (text ?? '').replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim()
  return normalize(left) === normalize(right)
}

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

/** Content of a file inside a tagged tree, or null when the tag does not have it. */
function taggedFile(path, ref) {
  try {
    // A missing path is an expected answer here, so git's own complaint is
    // swallowed — the failure is reported by the caller, in Russian.
    return execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
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

/** Stable, linkable anchor of the tag in CHANGELOG.md: v0.8.4-rc.1 → v-0-8-4-rc-1 */
const anchorOf = tag => tag.replace(/^v/, 'v-').replace(/[.\s]/g, '-')

/**
 * Whether a tagged tree's changelog fails to document this version. The entry
 * is written before the tag, so a tag cut the old way has none — and no commit
 * after the tag can put one there.
 */
export function missingChangelogEntry(tag, changelog) {
  return !(changelog ?? '').includes(`<a id="${anchorOf(tag)}">`)
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

  // The tagged tree is read at the commit origin refuses to point the tag at,
  // not at the local tag name: this is what CI checks out for a tag push, where
  // the local ref is not guaranteed (a detached HEAD at the tag commit is), and
  // the remote tag is the one whose release is being published either way.
  // The tree, not the working tree, is what the artifacts were built from; a
  // mismatch means the exe does not belong to this tag.
  const taggedVersion = JSON.parse(read('git', ['show', `${tagCommit}:package.json`])).version
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

  // The changelog entry is written before the tag, so the version is documented
  // in the very tree the artifacts are built from. A tag cut the old way has no
  // entry, and no later commit can repair it — only a new tag on a new commit can.
  const changelog = taggedFile(CHANGELOG, tagCommit)
  if (changelog === null) {
    fail(
      `в дереве тега ${tag} нет ${CHANGELOG} — релиз останется без записи в списке версий`,
      `добавьте файл в историю тега или переставьте тег: git tag -f ${tag} <коммит>`,
    )
  }
  if (missingChangelogEntry(tag, changelog)) {
    fail(
      `в ${CHANGELOG} дерева тега ${tag} нет записи ${tag} — версия публикуется, а в списке версий её нет`,
      `следующий релиз соберите через npm run release:prepare (запись пишется до тега); ` +
        `для этого тега: git tag -f ${tag} <коммит с записью> && git push --force origin ${tag}`,
    )
  }
  console.log(`  запись ${tag} есть в ${CHANGELOG} самого тега`)

  const build = resolveBuild()
  console.log(
    build.source === 'local'
      ? `  артефакты: ${artifacts.length} файла из release/, exe ${build.exeSize} Б, sha512 сверен`
      : `  артефакты: ${artifacts.length} файла уже на релизе ${tag} (сборка CI), exe ${build.exeSize} Б`,
  )
  return build
}

const artifactPath = name => join(artifactDir, name)

/**
 * Verifies release/latest.yml — what the updater reads — against the exe next to
 * it, and returns that exe's size.
 */
function localBuildSize() {
  const manifest = readFileSync(artifactPath('latest.yml'), 'utf8')
  const ymlVersion = /^version:\s*(.+)$/m.exec(manifest)?.[1].trim()
  if (ymlVersion !== version) {
    fail(
      `latest.yml описывает версию ${ymlVersion}, а публикуется ${version}`,
      'пересоберите дистрибутив: npm run dist',
    )
  }

  const expectedHash = /^sha512:\s*(.+)$/m.exec(manifest)?.[1].trim()
  const actualHash = createHash('sha512').update(readFileSync(artifactPath(artifacts[0]))).digest('base64')
  if (expectedHash !== actualHash) {
    fail(
      `sha512 в latest.yml не совпадает с ${artifacts[0]} — автообновление отклонит загрузку`,
      'пересоберите дистрибутив: npm run dist',
    )
  }

  return statSync(artifactPath(artifacts[0])).size
}

/** Sizes of this version's assets on the release, or null when they are not all there. */
function assetsOnRelease() {
  let info
  try {
    info = ghJson(['release', 'view', tag, '--json', 'isDraft,assets'])
  } catch {
    return null
  }
  const assets = new Map(info.assets.map(asset => [asset.name, asset.size]))
  return artifacts.every(name => assets.has(name)) ? assets : null
}

/**
 * What this run publishes. A local build is the stronger source — latest.yml is
 * compared with the bytes on disk — but the usual path is a tag pushed for CI to
 * build, and there the draft is the only source: the release carries the exe,
 * the manifest and the blockmap, and nothing is uploaded again.
 */
function resolveBuild() {
  if (artifacts.every(name => existsSync(artifactPath(name)))) {
    return { source: 'local', exeSize: localBuildSize() }
  }

  const assets = assetsOnRelease()
  if (!assets) {
    fail(
      `нет сборки ни в release/, ни на релизе ${tag}`,
      `соберите дистрибутив (npm run dist) или отправьте тег и дождитесь сборки CI: git push origin ${tag}`,
    )
  }
  return { source: 'ci', exeSize: assets.get(artifacts[0]) }
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
  const notes = notesFile ? ['--notes-file', notesFile] : []

  if (releaseExists()) {
    console.log(`  релиз ${tag} уже есть — обновляю флаги, тело и ассеты`)
    mutate(['release', 'edit', tag, '--draft=false', ...notes, ...flags])
    return
  }

  if (notesFile) {
    console.log(`  тело релиза: ${notesFile}`)
    mutate(['release', 'create', tag, '--title', `HueForge ${tag}`, '--notes-file', notesFile, '--verify-tag', ...flags])
  } else {
    warn(`нет release-notes/${tag}.md — GitHub сгенерирует ноты из коммитов, и они разойдутся с записью в CHANGELOG.md`)
    mutate(['release', 'create', tag, '--title', `HueForge ${tag}`, '--generate-notes', '--verify-tag', ...flags])
  }
}

function verifyChannel(build, notesFile) {
  const { exeSize } = build
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

  // The release page and the tagged changelog entry come from one file, so a
  // difference here means the release tells a different story than the tag.
  if (notesFile) {
    const published = ghJson(['release', 'view', tag, '--json', 'body']).body ?? ''
    if (!sameText(published, readFileSync(notesFile, 'utf8'))) {
      fail(
        `тело релиза ${tag} отличается от ${notesFile}`,
        `gh release edit ${tag} --notes-file ${notesFile}`,
      )
    }
    console.log(`  тело релиза совпадает с ${notesFile}`)
  }

  // The updater's own path: fetch latest.yml back from the release and make
  // sure it describes the exe that sits there.
  const temp = mkdtempSync(join(tmpdir(), 'release-publish-'))
  try {
    gh('release', 'download', tag, '--pattern', 'latest.yml', '--output', join(temp, 'latest.yml'), '--clobber')
    const published = readFileSync(join(temp, 'latest.yml'), 'utf8')
    const publishedVersion = /^version:\s*(.+)$/m.exec(published)?.[1].trim()
    const publishedHash = /^sha512:\s*(.+)$/m.exec(published)?.[1].trim()
    const manifestSize = Number(/^\s+size:\s*(\d+)$/m.exec(published)?.[1] ?? NaN)

    if (publishedVersion !== version) {
      fail(
        `latest.yml в релизе описывает версию ${publishedVersion} вместо ${version}`,
        `gh release upload ${tag} release/latest.yml --clobber`,
      )
    }
    if (!publishedHash) {
      fail(
        'в latest.yml релиза нет sha512 — автообновление отклонит загрузку',
        `gh release upload ${tag} release/latest.yml --clobber`,
      )
    }
    if (manifestSize !== exeSize) {
      fail(
        `latest.yml релиза обещает ${manifestSize} Б, а установщик там ${exeSize} Б — загрузка не завершилась`,
        `gh release upload ${tag} release/latest.yml release/${artifacts[0]} --clobber`,
      )
    }

    if (build.source === 'local') {
      const localHash = /^sha512:\s*(.+)$/m.exec(readFileSync(artifactPath('latest.yml'), 'utf8'))?.[1].trim()
      if (publishedHash !== localHash) fail('latest.yml в релизе отличается от собранного')
      console.log('  latest.yml в релизе совпадает с собранным')
    } else {
      console.log(`  latest.yml в релизе описывает установщик (sha512 ${publishedHash.slice(0, 16)}…, ${exeSize} Б)`)
    }
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
  const build = preflight()
  const notesFile = notesFor(tag)
  step('Публикация')
  publish(notesFile)
  done.push('флаги канала выставлены по тегу')

  if (!DRY_RUN) {
    step('Загрузка артефактов')
    if (build.source === 'local') {
      mutate(['release', 'upload', tag, ...artifacts.map(artifactPath), '--clobber'])
      done.push(`загружено ${artifacts.length} артефакта из сборки`)
    } else {
      console.log(`  не нужна: ${artifacts.length} ассета уже на релизе (сборка CI)`)
      done.push('артефакты оставлены те, что собрал CI')
    }

    step('Проверка канала')
    verifyChannel(build, notesFile)
    done.push('канал и артефакты сверены')
  }

  const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner')
  console.log(`\nГотово: https://github.com/${repo}/releases/tag/${tag}`)
  for (const item of done) console.log(`  ✓ ${item}`)
  if (!isPrerelease) console.log('  ✓ RC-установки получат эту версию по semver')
  console.log('\nДальше (не обязательно): npm run changelog:sync — заменит «Ожидает тега» на канал релиза.')
}

// Importable for tests — `main()` only runs when invoked as a script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    if (error instanceof PublishError) {
      console.error(`\n✗ ${error.message}`)
      process.exit(1)
    }
    throw error
  }
}
