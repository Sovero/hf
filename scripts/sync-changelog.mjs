#!/usr/bin/env node
/**
 * Regenerates the release part of CHANGELOG.md from this repository's GitHub
 * releases, so version notes live in the repo instead of only on the release
 * pages.
 *
 * What it does:
 * - copies every release body verbatim (demoted by one heading level, minus the
 *   body title when it only repeats the product and version);
 * - lists the releases in an index table with date and channel;
 * - for releases that carry no notes of their own (GitHub's auto-generated
 *   "Full Changelog" stubs) builds categorized notes out of the commits between
 *   the tags — grouped by type, each entry linked to its commit — instead of
 *   dumping a flat list of subjects;
 * - renders a version whose notes are written in `release-notes/<tag>.md` but
 *   whose release does not exist yet. A version's entry has to be written
 *   *before* its tag, otherwise the entry lands outside the tagged tree and
 *   `git show <tag>:CHANGELOG.md` shows a version that is not in the file. The
 *   repository can supply notes for a release that GitHub does not have yet;
 *   GitHub takes the entry over word for word once the release is published.
 *
 * It only rewrites the region between the `releases:start` / `releases:end`
 * markers, so the hand-written header above stays untouched.
 *
 * Usage: npm run changelog:sync   (requires an authenticated `gh`)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = path.join(root, 'CHANGELOG.md')
const START = '<!-- releases:start -->'
const END = '<!-- releases:end -->'

/**
 * Notes of versions that are prepared but not released yet — one file per tag,
 * named after the tag. See `pendingReleases` for why they exist.
 */
const NOTES_DIR = path.join(root, 'release-notes')
const NOTES_FILE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md$/

/** Commit subjects that only shuffle version numbers are noise in a changelog. */
const NOISE = [
  /^release:?\s+prepare\b/i,
  /^release\s+v?\d+\.\d+\.\d+/i,
  /^(?:chore|build|ci):\s+(?:bump|sync|cut)\b/i,
  /^bump (?:the )?version\b/i,
  /^v?\d+\.\d+\.\d+\s*(?:\(|:|$)/i,
]

export const isNoise = (subject) => NOISE.some((re) => re.test(subject))

/** Reader-facing sections, in the order they are rendered. */
const SECTIONS = [
  ['breaking', '⚠️ Ломающие изменения'],
  ['feat', '✨ Новое'],
  ['fix', '🐛 Исправления'],
  ['perf', '⚡ Производительность'],
  ['ui', '🎨 Интерфейс и полировка'],
  ['internal', '♻️ Внутреннее'],
  ['docs', '📚 Документация'],
  ['tools', '🔧 Сборка, CI и тесты'],
  ['other', 'Прочие изменения'],
]

/** Conventional-commit type → section. An unknown type falls through to `other`. */
const TYPE_SECTION = {
  feat: 'feat', feature: 'feat',
  fix: 'fix', bugfix: 'fix', hotfix: 'fix', revert: 'fix',
  perf: 'perf', performance: 'perf',
  ui: 'ui', style: 'ui', design: 'ui',
  refactor: 'internal', chore: 'internal',
  docs: 'docs', doc: 'docs',
  test: 'tools', tests: 'tools', ci: 'tools', build: 'tools', deps: 'tools',
}

/**
 * The oldest commits are plain imperative sentences rather than typed ones, so
 * they are read by their leading verb. Only unambiguous verbs are listed —
 * anything else goes to `other`, which is honest and never misfiles.
 */
const VERB_SECTION = [
  [
    /(?:\bci\b|github actions|workflow|installer|electron-builder|package-lock|make-icon|deploy (?:package|script)|build script)/i,
    'tools',
  ],
  [/^(?:add|implement|introduce|support|enable|allow|ship|attach|bring|parse)\b/i, 'feat'],
  [/^(?:fix|correct|repair|harden|avoid|prevent|revert)\b/i, 'fix'],
  [
    /^(?:show|hide|style|translate|center|space|size|align|left-align|tint|wrap|shorten|compact|restructure|fit|mirror|polish)\b/i,
    'ui',
  ],
  [/^(?:document|expand|describe)\b/i, 'docs'],
  [/^(?:refactor|rename|clean)\b/i, 'internal'],
]

export const MAX_PER_SECTION = 20

/**
 * First line of a notes file that was generated rather than written. The line is
 * visible on purpose: both release scripts refuse to cut or publish a version
 * whose notes still carry it, so an auto-assembled draft cannot slip out as a
 * release body.
 */
export const DRAFT_MARKER = '> **Черновик нот.**'

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<rest>\S.*)$/i

const sh = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const gh = (...args) => sh('gh', args)
const git = (...args) => sh('git', args)

/** Bodies that carry no notes — just GitHub's compare link. */
function isStub(body) {
  return (body ?? '').replace(/\*\*Full Changelog\*\*:.*/gi, '').replace(/[-\s]/g, '') === ''
}

/** Release bodies often open with their own title ("# HueForge Web v0.7.8"). */
function normalizeBody(body) {
  const lines = (body ?? '').replace(/\r\n/g, '\n').trim().split('\n')

  const title = /^#{1,3}\s+(.*)$/.exec(lines[0] ?? '')
  if (title && /^(?:HueForge(?: Web| Desktop)?\s*)?v?\d+\.\d+\.\d+/i.test(title[1].trim())) {
    const tail = /[—–:]\s*(.+)$/.exec(title[1])
    lines[0] = tail ? `_${tail[1].trim()}_` : ''
  }

  return lines
    .map((line) => line.replace(/^(#{1,6})(\s)/, '#$1$2')) // demote so the version stays the top heading
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Commits of `fromTag..toTag` (`fromTag` null = everything up to the tag). */
function commitsIn(fromTag, toTag) {
  const range = fromTag ? `${fromTag}..${toTag}` : toTag
  return git('log', '--no-merges', '--pretty=format:%h%x1f%s%x1f%b%x1e', range)
    .split('\x1e')
    .map((raw) => raw.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .map((raw) => {
      const [hash, subject = '', body = ''] = raw.split('\x1f')
      return { hash, subject: subject.trim(), body }
    })
    .filter((commit) => commit.subject && !isNoise(commit.subject))
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/** Russian counts need their own forms: 1 коммит, 2 коммита, 5 коммитов. */
function count(n, forms) {
  const withinHundred = n % 100
  if (withinHundred >= 11 && withinHundred <= 14) return forms[2]
  const withinTen = n % 10
  if (withinTen === 1) return forms[0]
  if (withinTen >= 2 && withinTen <= 4) return forms[1]
  return forms[2]
}

/** One commit → one changelog entry: which section it belongs to and how it reads. */
export function entryOf(commit) {
  const typed = CONVENTIONAL.exec(commit.subject)
  const breaking =
    Boolean(typed?.groups?.breaking) || /^BREAKING[ -]CHANGE:/m.test(commit.body)

  if (typed) {
    const { type, scope, rest } = typed.groups
    const prefix = scope ? `**${scope}**: ` : ''
    const section = breaking ? 'breaking' : (TYPE_SECTION[type.toLowerCase()] ?? 'other')
    return { section, text: `${prefix}${cap(rest)}`, hash: commit.hash }
  }

  const section = breaking
    ? 'breaking'
    : (VERB_SECTION.find(([re]) => re.test(commit.subject))?.[1] ?? 'other')
  return { section, text: commit.subject, hash: commit.hash }
}

/** One entry as a bullet — linked when the repository URL is known, plain otherwise. */
const entryLine = (entry, repoUrl) =>
  repoUrl
    ? `- ${entry.text} ([${entry.hash}](${repoUrl}/commit/${entry.hash}))`
    : `- ${entry.text} (\`${entry.hash}\`)`

/**
 * Entries grouped into reader-facing sections, each one linked to its commit.
 * `level` is 3 for a release body assembled on the fly and 2 for a notes file —
 * a file is one heading level higher, so both end up as `###` in CHANGELOG.md.
 */
function renderSections(commits, repoUrl, level = 3) {
  const entries = commits.map(entryOf)
  const lines = []
  const heading = '#'.repeat(level)

  for (const [section, title] of SECTIONS) {
    const items = entries.filter((entry) => entry.section === section)
    if (items.length === 0) continue

    lines.push('', `${heading} ${title}`)
    for (const entry of items.slice(0, MAX_PER_SECTION)) {
      lines.push(entryLine(entry, repoUrl))
    }
    if (items.length > MAX_PER_SECTION) {
      lines.push(`- …и ещё ${items.length - MAX_PER_SECTION}`)
    }
  }

  return lines
}

/** Human-readable range of notes: `` `v0.8.3` … `v0.8.4` ``. */
const rangeLabel = (fromTag, toTag) =>
  fromTag ? `\`${fromTag}\` … \`${toTag}\`` : `\`${toTag}\``

/**
 * Notes for a release that has none of its own. The commits behind it are the
 * only honest source, but a reader wants categories and a way back to the
 * change — so they are grouped and linked instead of dumped verbatim.
 */
export function notesFromCommits(commits, { fromTag, toTag, widened = false, repoUrl }) {
  const range = widened ? `\`${toTag}\` (от \`${fromTag}\`)` : rangeLabel(fromTag, toTag)
  const notes = [
    `_Заметок к этому релизу нет — разделы собраны из ${commits.length} ` +
      `${count(commits.length, ['коммит', 'коммита', 'коммитов'])} за ${range}._`,
    ...renderSections(commits, repoUrl),
  ]

  return notes.join('\n')
}

/**
 * Draft notes for a version that has no notes file yet — the starting point
 * `release:prepare` writes instead of refusing to cut the release. The sections
 * are assembled from the commits of the range; the marker line says so, and the
 * release scripts refuse to cut or publish while it is still there.
 */
export function draftNotes(commits, { fromTag, toTag, repoUrl, withCompareLink = true }) {
  const range = rangeLabel(fromTag, toTag)
  const lines = [
    `${DRAFT_MARKER} Разделы ниже собраны из ${commits.length} ` +
      `${count(commits.length, ['коммита', 'коммитов', 'коммитов'])} за ${range}: перепишите их в прозу, ` +
      'добавьте в начало абзац-суть и удалите эту строку.',
    ...renderSections(commits, repoUrl, 2),
  ]

  if (withCompareLink && fromTag && repoUrl) {
    lines.push('', `**Полный changelog**: ${repoUrl}/compare/${fromTag}...${toTag}`)
  }

  return lines.join('\n')
}

/** Commits between two revisions, noise dropped — the material of a draft. */
export function rangeCommits(fromRev, toRev) {
  return commitsIn(fromRev, toRev)
}

/**
 * A stable tag often sits right behind its own release-prep commit, leaving the
 * range to the previous release empty. Widen the range until some real work
 * shows up, but stay honest about where the range starts.
 */
function fallbackBody(previousTags, toTag, repoUrl) {
  // The very first release has nothing before it — that range is its whole history.
  const candidates = previousTags.length > 0 ? previousTags : [null]

  for (const [depth, fromTag] of candidates.entries()) {
    const commits = commitsIn(fromTag, toTag)
    if (commits.length === 0) continue

    const notes = notesFromCommits(commits, {
      fromTag,
      toTag,
      widened: depth > 0,
      repoUrl,
    })
    return { notes, fromTag }
  }
  return {
    notes: 'Заметок к этому релизу нет, отдельных изменений относительно предыдущего тоже.',
    fromTag: previousTags[0],
  }
}

/** Stable, linkable id for a tag: v0.8.3-rc.4 → v0-8-3-rc-4 */
const idFor = (tag) => tag.replace(/^v/, 'v-').replace(/[.\s]/g, '-')

/** Drafts have no publish date yet, so fall back to when they were created. */
const stampOf = (release) =>
  (release.published_at?.startsWith('0001') ? release.created_at : release.published_at) ??
  release.created_at

const dateOf = (release) => stampOf(release).slice(0, 10)

// ---------------------------------------------------------------------------
// A version prepared in the repository, not on GitHub yet
// ---------------------------------------------------------------------------

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Pre-release identifier of a version, or null for a stable one (undefined if not semver). */
function prereleaseOf(version) {
  const match = SEMVER.exec(version)
  return match ? (match[4] ?? null) : undefined
}

/** Newest version first; a release outranks its own candidate (0.8.4 above 0.8.4-rc.1). */
function compareVersions(a, b) {
  const core = SEMVER.exec(a).slice(1, 4).map(Number)
  const other = SEMVER.exec(b).slice(1, 4).map(Number)
  for (let i = 0; i < core.length; i += 1) {
    if (core[i] !== other[i]) return core[i] - other[i]
  }
  const left = prereleaseOf(a)
  const right = prereleaseOf(b)
  if (left === null && right !== null) return 1
  if (left !== null && right === null) return -1
  return (left ?? '').localeCompare(right ?? '', undefined, { numeric: true })
}

/** Tag of a notes file, or null when the name is not a tag (`README.md`, `draft.md`). */
export function versionFromNotesFile(fileName) {
  const match = NOTES_FILE.exec(fileName)
  return match ? match[1] : null
}

/**
 * Entries for versions whose notes are in the repository but whose release is
 * not on GitHub yet, newest first. An empty file is not an entry — it is a
 * placeholder waiting for prose. `dateOf` and `hasTag` are injected so the
 * ordering and the channel label can be tested without git or the network.
 */
export function pendingReleases(files, { dateOf: dateFor, hasTag }) {
  return files
    .map((file) => {
      const version = versionFromNotesFile(file.name)
      const notes = (file.body ?? '').trim()
      if (version === null || notes === '') return null

      const prerelease = prereleaseOf(version)
      if (prerelease === undefined) return null

      const tag = `v${version}`
      return {
        tag,
        version,
        notes,
        prerelease: prerelease !== null,
        date: dateFor(tag),
        channel: hasTag(tag) ? 'Ожидает публикации' : 'Ожидает тега',
      }
    })
    .filter((release) => release !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || compareVersions(b.version, a.version))
}

/**
 * Notes of versions that are already released: the release body wins, because
 * that is what the release page shows. A body that differs from the file means
 * the file went stale — worth saying out loud instead of dropping it silently.
 */
export function pendingShadowedBy(pending, releases) {
  const published = new Map(releases.map((release) => [release.tag_name, release.body ?? '']))
  return pending
    .filter((release) => published.has(release.tag))
    .map((release) => ({
      tag: release.tag,
      differs: normalizeBody(published.get(release.tag)) !== normalizeBody(release.notes),
    }))
}

/** Index row of a version that has a changelog entry but no release page yet. */
export function pendingRow(release) {
  return `| ${release.tag} · [в файле](#${idFor(release.tag)}) | ${release.date} | ${release.channel} |`
}

/** Changelog section of a version whose notes live in the repository. */
export function pendingSection(release, repoUrl) {
  return [
    `<a id="${idFor(release.tag)}"></a>`,
    '',
    `## ${release.tag} — ${release.date} · ${release.channel}`,
    '',
    normalizeBody(release.notes),
    '',
    `Страница релиза появится после публикации тега \`${release.tag}\`; заметки — в ` +
      `[release-notes/${release.tag}.md](${repoUrl}/blob/HEAD/release-notes/${release.tag}.md).`,
    '',
  ].join('\n')
}

/** Notes files in the repository, as `{ name, body }`. */
function readNotesFiles() {
  if (!existsSync(NOTES_DIR)) return []
  return readdirSync(NOTES_DIR)
    .filter((name) => NOTES_FILE.test(name))
    .map((name) => ({ name, body: readFileSync(path.join(NOTES_DIR, name), 'utf8') }))
}

/**
 * The release a version is compared against: a candidate is built on the
 * previous tag of any kind, a stable version on the previous *stable* tag —
 * that is the whole delta the stable channel receives, so its notes have to
 * cover it. Garbage tag names are ignored rather than sorted.
 */
export function previousTagFor(tags, version) {
  const isCandidate = prereleaseOf(version) !== null
  const candidates = tags
    .map((tag) => tag.replace(/^v/, ''))
    .filter((other) => SEMVER.test(other) && other !== version)
    .filter((other) => isCandidate || prereleaseOf(other) === null)

  if (candidates.length === 0) return null
  candidates.sort((a, b) => compareVersions(b, a))
  return `v${candidates[0]}`
}

/**
 * Date of a version that has no release page yet: the tag once it is cut,
 * otherwise the commit that bumped the version. Both are stable across repeated
 * runs, so a sync does not rewrite the date of an entry it already wrote.
 */
function pendingDate(tag) {
  // Asking for a tag that does not exist yet makes git complain on stderr, so
  // existence is checked first — the tag-free check is quiet.
  const sources = tagExists(tag)
    ? [['log', '-1', '--format=%cs', tag], ['log', '-1', '--format=%cs', '--', 'package.json']]
    : [['log', '-1', '--format=%cs', '--', 'package.json']]

  for (const args of sources) {
    try {
      const date = git(...args)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
    } catch {
      // No commits at all — try the next source.
    }
  }
  return new Date().toISOString().slice(0, 10)
}

/** Whether the tag is cut already — that is what tells "Ожидает тега" from "Ожидает публикации". */
function tagExists(tag) {
  try {
    git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)
    return true
  } catch {
    return false
  }
}

function channelOf(release, latestTag) {
  if (release.draft) return 'Черновик'
  if (release.prerelease) return 'Pre-release'
  return release.tag_name === latestTag ? 'Latest' : 'Стабильный'
}

function section(release, previousTags, repoUrl, latestTag) {
  const { tag_name: tag, html_url: url } = release
  const body = release.body ?? ''
  const fallback = isStub(body) ? fallbackBody(previousTags, tag, repoUrl) : null
  const notes = fallback ? fallback.notes : normalizeBody(body)
  // The compare link must cover the range the notes were actually taken from.
  const previousTag = fallback?.fromTag ?? previousTags[0]

  // Most notes already end with their own compare link — don't duplicate it.
  const hasLink = /github\.com\/[^)\s]+\/(compare|releases)\//.test(notes)
  const compare = previousTag
    ? `${repoUrl}/compare/${previousTag}...${tag}`
    : `${repoUrl}/commits/${tag}`

  return [
    `<a id="${idFor(tag)}"></a>`,
    '',
    `## ${tag} — ${dateOf(release)} · ${channelOf(release, latestTag)}`,
    '',
    notes,
    ...(hasLink ? [] : ['', `**Полный список изменений**: ${compare}`]),
    '',
    `Страница релиза: ${url}`,
    '',
  ].join('\n')
}

function main() {
  const doc = readFileSync(changelogPath, 'utf8')
  const start = doc.indexOf(START)
  const end = doc.indexOf(END)
  if (start < 0 || end < 0) {
    throw new Error(`CHANGELOG.md must contain both ${START} and ${END} markers`)
  }

  const releases = JSON.parse(gh('api', 'repos/{owner}/{repo}/releases?per_page=100', '--paginate'))
  if (releases.length === 0) throw new Error('no releases found — is `gh` authenticated for this repo?')

  // Newest first by date, so draft candidates land next to their iteration
  // instead of keeping GitHub's creation order.
  releases.sort((a, b) => stampOf(b).localeCompare(stampOf(a)))

  // Versions written in the repository but not published yet go on top of the
  // list; the ones GitHub already knows are dropped in favour of the release.
  const pending = pendingReleases(readNotesFiles(), { dateOf: pendingDate, hasTag: tagExists })
  const publishedTags = new Set(releases.map((release) => release.tag_name))
  for (const shadowed of pendingShadowedBy(pending, releases)) {
    console.log(
      shadowed.differs
        ? `! release-notes/${shadowed.tag}.md расходится с телом релиза ${shadowed.tag} — в CHANGELOG идёт релиз с GitHub`
        : `release-notes/${shadowed.tag}.md выпущен — запись берётся из релиза на GitHub`,
    )
  }
  const queued = pending.filter((release) => !publishedTags.has(release.tag))

  const repoUrl = releases[0].html_url.replace(/\/releases\/.*$/, '')
  let latestTag = ''
  try {
    latestTag = gh('api', 'repos/{owner}/{repo}/releases/latest', '--jq', '.tag_name')
  } catch {
    // No release carries the Latest label yet.
  }

  const index = [
    '| Версия | Дата | Канал |',
    '| --- | --- | --- |',
    ...queued.map(pendingRow),
    ...releases.map(
      (r) =>
        `| [${r.tag_name}](${repoUrl}/releases/tag/${r.tag_name}) · [в файле](#${idFor(r.tag_name)}) ` +
        `| ${dateOf(r)} | ${channelOf(r, latestTag)} |`,
    ),
  ].join('\n')

  const sections = [
    ...queued.map((release) => pendingSection(release, repoUrl)),
    ...releases.map((release, i) =>
      section(release, releases.slice(i + 1, i + 4).map((r) => r.tag_name), repoUrl, latestTag),
    ),
  ].join('\n---\n\n')

  const generated = [START, '', index, '', '---', '', sections.trimEnd(), '', END].join('\n')

  // Collapse stray `releases:end` markers so a file damaged by an older run
  // heals instead of accumulating one more marker per sync.
  const out = `${doc.slice(0, start)}${generated}${doc.slice(end + END.length)}`.replace(
    /(?:<!-- releases:end -->[ \t]*)+/g,
    END,
  )
  writeFileSync(changelogPath, out)

  const filled = releases.filter((r) => isStub(r.body ?? '')).length
  console.log(`CHANGELOG.md: ${releases.length} releases, ${filled} filled from commit history`)
  if (queued.length > 0) {
    console.log(`  из release-notes/ (ещё не выпущены): ${queued.map((r) => r.tag).join(', ')}`)
  }
  console.log(`markers: ${(out.match(/<!-- releases:(?:start|end) -->/g) ?? []).join(' ... ')}`)
}

// Importable for tests — `main()` only runs when invoked as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
