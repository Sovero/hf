#!/usr/bin/env node
/**
 * Cuts a release in the order that keeps the version's changelog entry inside
 * the tag.
 *
 * Why this exists: `changelog:sync` takes the notes of a release from the
 * release page, and a release cannot exist before its tag — so as long as the
 * sync ran after the tag (the previous order), the version's entry always
 * landed *outside* the tagged tree: `git show v0.8.3:CHANGELOG.md` had no
 * v0.8.3. The repository can describe a release GitHub does not have yet, so
 * the notes of the upcoming version live in `release-notes/<tag>.md` and the
 * sync renders them before the tag is cut. GitHub then takes the entry over
 * word for word once the release is published, and `release:publish` refuses to
 * publish a tag whose CHANGELOG.md does not carry the version.
 *
 * What it does, in this order:
 *   1. preflight: branch, clean tree, in sync with origin, both tags free;
 *   1a. requires release-notes/<tag>.md, and when it is missing writes a draft
 *      assembled from the commits between the previous release and HEAD, then
 *      stops: the draft is marked, and neither this script nor `release:publish`
 *      will cut or publish a version whose notes still carry the marker;
 *   2. bumps package.json (and package-lock.json) and commits the bump — this
 *      commit's date is what a not-yet-tagged entry is dated by;
 *   3. runs the changelog sync, so the entry exists before the tag;
 *   4. commits CHANGELOG.md together with the notes file;
 *   5. tags that commit — the tree the release is built from.
 *
 * Usage:
 *   npm run release:prepare -- --version 0.8.4
 *   npm run release:prepare -- --version 0.8.4 --dry-run   # show, change nothing
 *
 * Pushing stays manual on purpose: the script prints the command and ends. That
 * one push is the whole release — the tag starts the Release workflow, whose
 * last stages publish the release and refresh the changelog on the default
 * branch, so no `release:publish` after it is needed.
 */
import { execFileSync } from 'node:child_process'
import { draftNotes, DRAFT_MARKER, previousTagFor, rangeCommits } from './sync-changelog.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_BRANCH = 'main'
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const argv = process.argv.slice(2)
const has = name => argv.includes(`--${name}`)
const valueOf = name => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const DRY_RUN = has('dry-run')

const done = []
const step = message => console.log(`\n▸ ${message}`)

class PrepareError extends Error {}

function fail(message, fix) {
  throw new PrepareError(fix ? `${message}\n\n  Как поправить: ${fix}` : message)
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
}

/** Read-only git calls that are allowed to come back empty. */
function tryGit(...args) {
  try {
    return git(...args)
  } catch {
    return null
  }
}

/** Stable, linkable anchor of a tag in CHANGELOG.md: v0.8.4-rc.1 → v-0-8-4-rc-1 */
const anchorOf = tag => tag.replace(/^v/, 'v-').replace(/[.\s]/g, '-')

// ---------------------------------------------------------------------------
// 1. Preflight
// ---------------------------------------------------------------------------

function target() {
  const version = valueOf('version')
  if (!version) fail('не указана версия', 'npm run release:prepare -- --version 0.8.4')
  if (!SEMVER.test(version)) {
    fail(`«${version}» не похоже на версию`, 'годятся 0.8.4 (стабильный) и 0.8.4-rc.2 (кандидат)')
  }

  const tag = `v${version}`
  // Git paths are compared with what `git status --porcelain` prints, which is
  // always forward-slashed — so the notes path is built that way too.
  const notesPath = `release-notes/${tag}.md`
  step(`Релиз ${tag} · ${version.includes('-') ? 'pre-release' : 'стабильный канал (Latest)'}`)
  return { version, tag, notesPath }
}

function preflight({ tag, notesPath }) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== RELEASE_BRANCH) {
    fail(`релиз режется с ${RELEASE_BRANCH}, а вы на «${branch}»`, `git switch ${RELEASE_BRANCH}`)
  }

  // The notes file of this very version is expected to be uncommitted — the
  // release commits it. Everything else in the working tree is not a release.
  //
  // The status letters cannot be counted on as `slice(3)`: `git()` trims the
  // whole output, and for the first — or only — changed file that eats the
  // leading space of the status column, shifting the path by a character. The
  // path is what is compared, so it is cut off by the whitespace that follows
  // the status instead.
  const foreign = git('status', '--porcelain')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && line.replace(/^\S+\s+/, '') !== notesPath)
  if (foreign.length > 0) {
    fail(
      `в дереве есть посторонние незакоммиченные изменения:\n` +
        foreign.map(line => `    ${line}`).join('\n'),
      `закоммитьте или уберите их: релизный коммит должен содержать только версию, ноты (${notesPath}) и CHANGELOG`,
    )
  }

  if (tryGit('ls-remote', '--tags', 'origin', tag)) {
    fail(`тег ${tag} уже есть на origin`, `выберите следующую версию`)
  }
  if (tryGit('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)) {
    fail(`тег ${tag} уже есть локально`, `git tag -d ${tag}`)
  }

  // The release has to be cut from what main already has, otherwise the tag
  // ships a tree nobody else can see.
  if (DRY_RUN) {
    console.log('  [dry-run] сверка с origin пропущена')
  } else {
    git('fetch', 'origin', RELEASE_BRANCH)
    const head = git('rev-parse', 'HEAD')
    const remote = git('rev-parse', `origin/${RELEASE_BRANCH}`)
    if (head !== remote) {
      const [behind, ahead] = git('rev-list', '--left-right', '--count', `${remote}...${head}`).split(/\s+/)
      // Being behind is the usual state after a release: the Release workflow
      // commits the channel word to the default branch by itself, so the next
      // cut starts from a commit the developer never made — say so instead of
      // letting them work out where the extra commit came from.
      const fix =
        Number(behind) > 0
          ? `git pull --rebase origin ${RELEASE_BRANCH}   # позади — обычно коммит CI с каналом вышедшего релиза`
          : `git push origin ${RELEASE_BRANCH}`
      fail(
        `локальная ${RELEASE_BRANCH} не совпадает с origin/${RELEASE_BRANCH} (впереди ${ahead}, позади ${behind})`,
        fix,
      )
    }
  }

  console.log('  тег свободен, дерево без посторонних правок, ветка синхронизирована')
}

// ---------------------------------------------------------------------------
// 1a. Notes: written by hand, or assembled once and then rewritten
// ---------------------------------------------------------------------------

/** Tags present locally — the candidates for "what this release comes after". */
function knownTags() {
  return git('for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags')
    .split('\n')
    .filter((tag) => tag !== '')
}

/** `https://github.com/owner/repo` of the origin remote, or null when it is not GitHub. */
function repoUrl() {
  const remote = tryGit('remote', 'get-url', 'origin') ?? ''
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote)
  return match ? `https://github.com/${match[1]}/${match[2]}` : null
}

/**
 * The notes of a version, writing a draft when there is no file yet. A draft
 * stops the release: it is assembled from commit subjects, and a release body
 * that is not prose is worse than a release that waits a minute.
 */
function notesOf({ version, tag, notesPath }) {
  const path = join(root, notesPath)
  if (!existsSync(path)) {
    const from = previousTagFor(knownTags(), version)
    // `from` is null for the very first release — that range is the whole history.
    const commits = rangeCommits(from, 'HEAD')
    const draft = draftNotes(commits, {
      fromTag: from,
      toTag: tag,
      repoUrl: repoUrl(),
    })

    step('Черновик нот')
    if (DRY_RUN) {
      console.log(`  [dry-run] ${notesPath} ← черновик из ${commits.length} коммитов (${from ?? 'вся история'})`)
      return null
    }
    writeFileSync(path, `${draft}\n`)

    fail(
      `нот для ${tag} ещё нет — собран черновик ${notesPath} из ${commits.length} ` +
        `коммитов за ${from ? `\`${from}\` … \`${tag}\`` : `\`${tag}\``}`,
      `отредактируйте ${notesPath}: перепишите разделы в прозу, добавьте абзац-суть и удалите строку «Черновик нот», затем запустите ту же команду снова`,
    )
  }

  const body = readFileSync(path, 'utf8').trim()
  if (body === '') {
    fail(`${notesPath} пуст`, `напишите, что изменилось: разделы, исправления, как обновиться`)
  }
  if (body.includes(DRAFT_MARKER)) {
    fail(
      `${notesPath} всё ещё черновик — собранные из коммитов разделы нельзя выдавать за ноты релиза`,
      `перепишите разделы в прозу и удалите строку, начинающуюся с «Черновик нот»`,
    )
  }

  console.log(`  ноты: ${notesPath}, ${body.split('\n').length} строк`)
  return body
}

// ---------------------------------------------------------------------------
// 2. Version bump
// ---------------------------------------------------------------------------

/** Rewrites only the value, so the diff stays one line instead of a reformat. */
function setVersion(file, version) {
  const path = join(root, file)
  const raw = readFileSync(path, 'utf8')
  if (JSON.parse(raw).version === version) return false

  const patched = raw.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
  if (JSON.parse(patched).version !== version) fail(`не удалось записать версию в ${file}`)

  if (DRY_RUN) {
    console.log(`  [dry-run] ${file}: версия → ${version}`)
  } else {
    writeFileSync(path, patched)
  }
  return true
}

/**
 * The lock file carries the version twice (top level and the root package), and
 * npm rewrites the whole file — so both places are updated here as one edit.
 */
function setLockVersion(version) {
  const file = 'package-lock.json'
  if (!existsSync(join(root, file))) return false

  const lock = JSON.parse(readFileSync(join(root, file), 'utf8'))
  const rootPkg = lock.packages?.['']
  if (lock.version === version && rootPkg?.version === version) return false

  lock.version = version
  if (rootPkg) rootPkg.version = version

  if (DRY_RUN) {
    console.log(`  [dry-run] ${file}: версия → ${version}`)
  } else {
    writeFileSync(join(root, file), `${JSON.stringify(lock, null, 2)}\n`)
  }
  return true
}

function bump({ version }) {
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (current === version) {
    // Recovering from an interrupted run: the bump is already committed, only
    // the changelog entry and the tag are missing.
    console.log(`  в package.json уже ${version} — бамп не нужен`)
    return
  }

  step(`Бамп версии ${current} → ${version}`)
  const files = ['package.json']
  setVersion('package.json', version)
  if (setLockVersion(version)) files.push('package-lock.json')

  if (DRY_RUN) {
    console.log(`  [dry-run] git add ${files.join(' ')}`)
    console.log(`  [dry-run] git commit -m "chore: bump version to ${version}"`)
    return
  }
  git('add', ...files)
  git('commit', '-m', `chore: bump version to ${version}`)
  done.push(`бамп версии закоммичен`)
}

// ---------------------------------------------------------------------------
// 3. Changelog before the tag, then the tag
// ---------------------------------------------------------------------------

function syncChangelog({ tag, version }) {
  step('Синхронизация CHANGELOG.md (до тега)')

  if (DRY_RUN) {
    console.log('  [dry-run] node scripts/sync-changelog.mjs')
    return
  }
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'sync-changelog.mjs')], {
      cwd: root,
      stdio: 'inherit',
    })
  } catch {
    // Nothing beyond the bump has happened yet, and the bump is idempotent —
    // so the same command finishes the release once the cause is fixed.
    fail(
      'синхронизация CHANGELOG.md не прошла: запись версии не создана',
      'релиз не пошёл дальше бампа версии (он уже закоммичен); почините причину и запустите команду снова — бамп пропустится',
    )
  }

  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  if (!changelog.includes(`<a id="${anchorOf(tag)}">`)) {
    fail(
      `CHANGELOG.md не получил запись ${tag} — ноты ${version} не попали в раздел релизов`,
      `проверьте release-notes/${tag}.md (в силе файла должен быть текст релиза) и запустите npm run changelog:sync`,
    )
  }
  done.push(`запись ${tag} в CHANGELOG.md (до тега)`)
}

function commitChangelog({ tag, notesPath }) {
  step('Коммит записи')
  if (DRY_RUN) {
    console.log(`  [dry-run] git add CHANGELOG.md ${notesPath}`)
    console.log(`  [dry-run] git commit -m "docs(changelog): внести ноты ${tag} в CHANGELOG.md"`)
    return
  }
  git('add', 'CHANGELOG.md', notesPath)
  git('commit', '-m', `docs(changelog): внести ноты ${tag} в CHANGELOG.md`)
  done.push('ноты закоммичены')
}

function tagRelease({ tag, version }) {
  step(`Тег ${tag}`)
  if (DRY_RUN) {
    console.log(`  [dry-run] git tag ${tag}`)
    return
  }
  git('tag', tag)

  // The whole point of the order: the entry has to be visible *in the tag*.
  const tagged = git('show', `${tag}:CHANGELOG.md`)
  if (!tagged.includes(`<a id="${anchorOf(tag)}">`)) {
    fail(
      `в дереве тега ${tag} нет записи CHANGELOG.md`,
      `git tag -d ${tag} и закоммитьте запись перед тегом`,
    )
  }
  const taggedVersion = JSON.parse(git('show', `${tag}:package.json`)).version
  if (taggedVersion !== version) {
    fail(`в дереве тега ${tag} версия ${taggedVersion}`, `git tag -d ${tag} и повторите бамп версии`)
  }
  done.push(`тег ${tag} → ${git('rev-parse', '--short', tag)}, запись версии внутри тега`)
}

function main() {
  const plan = target()
  preflight(plan)
  notesOf(plan)
  bump(plan)
  syncChangelog(plan)
  commitChangelog(plan)
  tagRelease(plan)

  console.log(`\n${DRY_RUN ? 'Проверка пройдена (ничего не изменено):' : 'Готово:'}`)
  for (const item of done) console.log(`  ✓ ${item}`)

  console.log('\nДальше:')
  console.log(`  1. git push origin ${RELEASE_BRANCH} ${plan.tag}   # этим пушем релиз и выпускается`)
  console.log('     CI: проверки → сборка артефактов → публикация с флагами канала → CHANGELOG на main.')
  console.log(
    `     Ручной путь, только если CI недоступен: npm run dist и npm run release:publish для ${plan.tag}.`,
  )
  console.log(
    '\n`release:publish` не выпустит тег, в дереве которого нет записи версии — это и есть гарантия порядка.',
  )
}

try {
  main()
} catch (error) {
  if (error instanceof PrepareError) {
    console.error(`\n✗ ${error.message}`)
    process.exit(1)
  }
  throw error
}
