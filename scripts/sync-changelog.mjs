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
 * - falls back to the commit subjects between two tags for releases that carry
 *   no notes of their own (GitHub's auto-generated "Full Changelog" stubs).
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
const NOISE = /^(release: prepare\b|chore: (bump|sync|cut)\b)/i
const MAX_FALLBACK_LINES = 25

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

function commitSubjects(fromTag, toTag) {
  const range = fromTag ? `${fromTag}..${toTag}` : toTag
  return git('log', '--no-merges', '--pretty=%s', range)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !NOISE.test(s))
}

/**
 * A stable tag often sits right behind its own release-prep commit, leaving the
 * range to the previous release empty. Widen the range until some real work
 * shows up, but stay honest about where the range starts.
 */
function fallbackBody(previousTags, toTag) {
  for (const [depth, fromTag] of previousTags.entries()) {
    const subjects = commitSubjects(fromTag, toTag)
    if (subjects.length === 0) continue

    const scope = depth === 0 ? '' : ` (с ${fromTag})`
    const shown = subjects.slice(0, MAX_FALLBACK_LINES)
    const more = subjects.length - shown.length
    const notes = [
      `Заметок к этому релизу нет — изменения по истории коммитов${scope}:`,
      '',
      ...shown.map((s) => `- ${s}`),
      ...(more > 0 ? [`- …и ещё ${more}`] : []),
    ].join('\n')
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
  const fallback = isStub(body) ? fallbackBody(previousTags, tag) : null
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

main()
