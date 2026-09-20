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
 *   dumping a flat list of subjects.
 *
 * It only rewrites the region between the `releases:start` / `releases:end`
 * markers, so the hand-written header above stays untouched.
 *
 * Usage: npm run changelog:sync   (requires an authenticated `gh`)
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = path.join(root, 'CHANGELOG.md')
const START = '<!-- releases:start -->'
const END = '<!-- releases:end -->'

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

/**
 * Notes for a release that has none of its own. The commits behind it are the
 * only honest source, but a reader wants categories and a way back to the
 * change — so they are grouped and linked instead of dumped verbatim.
 */
export function notesFromCommits(commits, { fromTag, toTag, widened = false, repoUrl }) {
  const entries = commits.map(entryOf)
  const range = widened
    ? `\`${toTag}\` (от \`${fromTag}\`)`
    : fromTag
      ? `\`${fromTag}\` … \`${toTag}\``
      : `\`${toTag}\``
  const notes = [
    `_Заметок к этому релизу нет — разделы собраны из ${commits.length} ` +
      `${count(commits.length, ['коммит', 'коммита', 'коммитов'])} за ${range}._`,
  ]

  for (const [section, title] of SECTIONS) {
    const items = entries.filter((entry) => entry.section === section)
    if (items.length === 0) continue

    notes.push('', `### ${title}`)
    for (const entry of items.slice(0, MAX_PER_SECTION)) {
      notes.push(`- ${entry.text} ([${entry.hash}](${repoUrl}/commit/${entry.hash}))`)
    }
    if (items.length > MAX_PER_SECTION) {
      notes.push(`- …и ещё ${items.length - MAX_PER_SECTION}`)
    }
  }

  return notes.join('\n')
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
    ...releases.map(
      (r) =>
        `| [${r.tag_name}](${repoUrl}/releases/tag/${r.tag_name}) · [в файле](#${idFor(r.tag_name)}) ` +
        `| ${dateOf(r)} | ${channelOf(r, latestTag)} |`,
    ),
  ].join('\n')

  const sections = releases
    .map((release, i) =>
      section(release, releases.slice(i + 1, i + 4).map((r) => r.tag_name), repoUrl, latestTag),
    )
    .join('\n---\n\n')

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
  console.log(`markers: ${(out.match(/<!-- releases:(?:start|end) -->/g) ?? []).join(' ... ')}`)
}

// Importable for tests — `main()` only runs when invoked as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
