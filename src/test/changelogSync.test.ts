import { describe, expect, it } from 'vitest'
import {
  DRAFT_MARKER,
  MAX_PER_SECTION,
  draftNotes,
  entryOf,
  isNoise,
  notesFromCommits,
  pendingReleases,
  pendingRow,
  pendingSection,
  pendingShadowedBy,
  previousTagFor,
  versionFromNotesFile,
} from '../../scripts/sync-changelog.mjs'
import { missingChangelogEntry } from '../../scripts/release-publish.mjs'

const commit = (subject: string, body = '', hash = 'abc1234') => ({ hash, subject, body })

const notesFor = (
  commits: ReturnType<typeof commit>[],
  range: { fromTag: string | null; toTag: string; widened?: boolean } = {
    fromTag: 'v1.0.0',
    toTag: 'v1.1.0',
  },
) => notesFromCommits(commits, { ...range, repoUrl: 'https://example.test/repo' })

describe('changelog sync: commit noise', () => {
  it('drops commits that only shuffle version numbers', () => {
    expect(isNoise('release: prepare v0.8.2')).toBe(true)
    expect(isNoise('Release v0.7.8 (version bump)')).toBe(true)
    expect(isNoise('chore: bump version to 0.8.3-rc.4')).toBe(true)
    expect(isNoise('chore: sync package-lock version to 0.8.3-rc.4')).toBe(true)
    expect(isNoise('Bump version to 0.2.1')).toBe(true)
    expect(isNoise('0.8.3')).toBe(true)
  })

  it('keeps real changes', () => {
    expect(isNoise('feat: add frameless HueForge Desktop window')).toBe(false)
    expect(isNoise('Add one-time first-run language choice banner')).toBe(false)
    expect(isNoise('fix: write correct ICO header fields in make-icon')).toBe(false)
  })
})

describe('changelog sync: classifying a commit', () => {
  it('maps a conventional type to its section and strips the prefix', () => {
    expect(entryOf(commit('feat: add frameless HueForge Desktop window'))).toEqual({
      section: 'feat',
      text: 'Add frameless HueForge Desktop window',
      hash: 'abc1234',
    })
    expect(entryOf(commit('ci: build the Windows installer on a native runner')).section).toBe('tools')
    expect(entryOf(commit('docs: update release docs for stable v0.8.0')).section).toBe('docs')
    expect(entryOf(commit('chore: update package-lock.json for electron deps')).section).toBe('internal')
    expect(entryOf(commit('fix: harden desktop export')).section).toBe('fix')
  })

  it('keeps the scope visible in front of the entry', () => {
    expect(entryOf(commit('fix(mesh): drop the duplicate wall')).text).toBe(
      '**mesh**: Drop the duplicate wall',
    )
  })

  it('calls out breaking changes, from the marker or from the body', () => {
    expect(entryOf(commit('feat!: drop the legacy project format')).section).toBe('breaking')
    expect(entryOf(commit('feat: rework the pipeline', 'BREAKING CHANGE: projects must be re-saved')).section).toBe(
      'breaking',
    )
  })

  it('classifies untagged commits by their leading verb', () => {
    expect(entryOf(commit('Add English/Russian interface with a language switcher')).section).toBe('feat')
    expect(entryOf(commit('Fix reference 3MF UI defects found in review')).section).toBe('fix')
    expect(entryOf(commit('Translate nearest-filament names in the palette legend')).section).toBe('ui')
    expect(entryOf(commit('Document direct update.ps1 usage in DEPLOY.md')).section).toBe('docs')
    expect(entryOf(commit('Add GitHub Actions CI workflow')).section).toBe('tools')
  })

  it('leaves an unknown type or verb in the catch-all section rather than guessing', () => {
    expect(entryOf(commit('wip: half-finished thing')).section).toBe('other')
    expect(entryOf(commit('Move the image pipeline into a Web Worker')).section).toBe('other')
  })

  it('capitalizes the subject it renders, but keeps prose commits verbatim', () => {
    expect(entryOf(commit('feat: lower-case explanation')).text).toBe('Lower-case explanation')
    expect(entryOf(commit('Parse reference 3MF in a Web Worker and stream vertex bounds')).text).toBe(
      'Parse reference 3MF in a Web Worker and stream vertex bounds',
    )
  })
})

describe('changelog sync: notes built from commits', () => {
  it('groups entries into sections and links every commit', () => {
    const notes = notesFor([
      commit('ci: build the installer', '', 'aaaaaaa'),
      commit('fix: correct the ICO header', '', 'bbbbbbb'),
      commit('feat: add the desktop app', '', 'ccccccc'),
    ])

    expect(notes).toContain('за `v1.0.0` … `v1.1.0`')
    expect(notes).toContain('### ✨ Новое')
    expect(notes).toContain('- Add the desktop app ([ccccccc](https://example.test/repo/commit/ccccccc))')
    expect(notes.indexOf('✨ Новое')).toBeLessThan(notes.indexOf('🐛 Исправления'))
    expect(notes.indexOf('🐛 Исправления')).toBeLessThan(notes.indexOf('🔧 Сборка, CI и тесты'))
  })

  it('agrees the commit count with its Russian form', () => {
    expect(notesFor([commit('feat: one')])).toContain('из 1 коммит за')
    expect(notesFor([commit('feat: one'), commit('feat: two'), commit('feat: three')])).toContain(
      'из 3 коммита за',
    )
    expect(notesFor(Array.from({ length: 11 }, (_, i) => commit(`feat: change ${i}`)))).toContain(
      'из 11 коммитов за',
    )
  })

  it('names the widened range when the previous release had nothing to compare with', () => {
    const notes = notesFor([commit('feat: one')], {
      fromTag: 'v0.9.0',
      toTag: 'v1.1.0',
      widened: true,
    })
    expect(notes).toContain('за `v1.1.0` (от `v0.9.0`)')
  })

  it('reports the whole history of the first release instead of an empty range', () => {
    const notes = notesFor([commit('Add GitHub Actions CI workflow')], { fromTag: null, toTag: 'v0.2.0' })
    expect(notes).toContain('за `v0.2.0`')
    expect(notes).not.toContain('ничего')
  })

  it('caps a runaway section but says how many entries were left out', () => {
    const many = Array.from({ length: MAX_PER_SECTION + 3 }, (_, i) => commit(`feat: change ${i}`))
    const notes = notesFor(many)

    expect(notes.split('\n').filter((line: string) => line.startsWith('- '))).toHaveLength(
      MAX_PER_SECTION + 1,
    )
    expect(notes).toContain('- …и ещё 3')
  })
})

const file = (name: string, body: string) => ({ name, body })

/** Git lookups of `pendingReleases`, stubbed: no tag cut unless a test says so. */
const hooks = (dates: Record<string, string> = {}, cut: string[] = []) => ({
  dateOf: (tag: string) => dates[tag] ?? '2026-01-01',
  hasTag: (tag: string) => cut.includes(tag),
})

describe('changelog sync: versions prepared before their tag', () => {
  it('reads the tag from the file name and ignores files that are not a tag', () => {
    expect(versionFromNotesFile('v0.8.5.md')).toBe('0.8.5')
    expect(versionFromNotesFile('0.8.5.md')).toBe('0.8.5')
    expect(versionFromNotesFile('v0.8.5-rc.2.md')).toBe('0.8.5-rc.2')
    expect(versionFromNotesFile('README.md')).toBeNull()
    expect(versionFromNotesFile('draft.md')).toBeNull()
    expect(versionFromNotesFile('v0.8.5.txt')).toBeNull()
    expect(versionFromNotesFile('v0.8.md')).toBeNull()
  })

  it('turns a notes file into an entry, and an empty file into nothing', () => {
    const [entry] = pendingReleases(
      [file('v0.8.5.md', 'Стабильный релиз 0.8.5.'), file('v0.8.6.md', '   \n  ')],
      hooks({ 'v0.8.5': '2026-09-21' }),
    )

    expect(entry).toEqual({
      tag: 'v0.8.5',
      version: '0.8.5',
      notes: 'Стабильный релиз 0.8.5.',
      prerelease: false,
      date: '2026-09-21',
      channel: 'Ожидает тега',
    })
  })

  it('names the channel by how far the version has come: untagged, or waiting for publication', () => {
    const files = [file('v0.8.5-rc.1.md', 'Кандидат.'), file('v0.8.6.md', 'Стабильный.')]

    expect(pendingReleases(files, hooks()).map((r) => r.channel)).toEqual([
      'Ожидает тега',
      'Ожидает тега',
    ])
    expect(pendingReleases(files, hooks({}, ['v0.8.6'])).map((r) => r.channel)).toEqual([
      'Ожидает публикации',
      'Ожидает тега',
    ])
  })

  it('keeps the freshest version on top, and a release above its own candidate', () => {
    const files = [
      file('v0.8.5.md', 'Стабильный.'.padEnd(20, ' ')),
      file('v0.8.9.md', 'Позже.'.padEnd(20, ' ')),
      file('v0.8.10.md', 'Совсем позже.'.padEnd(20, ' ')),
    ]
    const dates = { 'v0.8.5': '2026-09-01', 'v0.8.9': '2026-09-20', 'v0.8.10': '2026-09-20' }

    expect(pendingReleases(files, hooks(dates)).map((r) => r.tag)).toEqual([
      'v0.8.10',
      'v0.8.9',
      'v0.8.5',
    ])

    const sameDay = [file('v0.8.5-rc.1.md', 'Кандидат.'), file('v0.8.5.md', 'Стабильный.')]
    expect(pendingReleases(sameDay, hooks()).map((r) => r.prerelease)).toEqual([false, true])
  })

  it('renders the entry with an anchor a later publish has to find', () => {
    const repoUrl = 'https://example.test/repo'
    const [entry] = pendingReleases([file('v0.8.5-rc.2.md', '## Тон рельефа\n\n- Ползунки.')], hooks({
      'v0.8.5-rc.2': '2026-09-21',
    }))
    const section = pendingSection(entry, repoUrl)

    expect(section).toContain('<a id="v-0-8-5-rc-2"></a>')
    expect(section).toContain('## v0.8.5-rc.2 — 2026-09-21 · Ожидает тега')
    expect(section).toContain('- Ползунки.')
    expect(section).toContain(`${repoUrl}/blob/HEAD/release-notes/v0.8.5-rc.2.md`)
    expect(pendingRow(entry)).toBe('| v0.8.5-rc.2 · [в файле](#v-0-8-5-rc-2) | 2026-09-21 | Ожидает тега |')
  })

  it('hands the entry over to GitHub once the release exists, and flags a stale file', () => {
    const [entry] = pendingReleases([file('v0.8.5.md', 'Стабильный релиз 0.8.5.')], hooks())

    expect(pendingShadowedBy([entry], [{ tag_name: 'v0.8.5', body: 'Стабильный релиз 0.8.5.' }])).toEqual([
      { tag: 'v0.8.5', differs: false },
    ])
    expect(pendingShadowedBy([entry], [{ tag_name: 'v0.8.5', body: 'Совсем другое описание.' }])).toEqual([
      { tag: 'v0.8.5', differs: true },
    ])
    expect(pendingShadowedBy([entry], [{ tag_name: 'v0.8.4', body: '' }])).toEqual([])
  })
})

describe('release notes draft: written before the notes exist', () => {
  it('marks the file, names the range and groups the commits', () => {
    const draft = draftNotes(
      [
        commit('feat: add frameless window', '', 'aaaaaaa'),
        commit('fix: correct the ICO header', '', 'bbbbbbb'),
        commit('ci: build the installer', '', 'ccccccc'),
      ],
      { fromTag: 'v0.8.3', toTag: 'v0.8.4', repoUrl: 'https://example.test/repo' },
    )

    expect(draft.startsWith(DRAFT_MARKER)).toBe(true)
    expect(draft).toContain('из 3 коммитов за `v0.8.3` … `v0.8.4`')
    // Level 2: the file is a release body, and the changelog demotes it to `###`.
    expect(draft).toContain('\n## ✨ Новое')
    expect(draft).toContain('- Add frameless window ([aaaaaaa](https://example.test/repo/commit/aaaaaaa))')
    expect(draft).toContain('**Полный changelog**: https://example.test/repo/compare/v0.8.3...v0.8.4')
    // The disclaimer of a release *without* notes would be wrong in a draft.
    expect(draft).not.toContain('Заметок к этому релизу нет')
  })

  it('agrees the commit count with its Russian form', () => {
    const one = draftNotes([commit('feat: one')], {
      fromTag: 'v0.8.3',
      toTag: 'v0.8.4',
      repoUrl: 'https://example.test/repo',
    })
    const eleven = draftNotes(
      Array.from({ length: 11 }, (_, i) => commit(`feat: change ${i}`)),
      { fromTag: 'v0.8.3', toTag: 'v0.8.4', repoUrl: 'https://example.test/repo' },
    )

    expect(one).toContain('из 1 коммита за')
    expect(eleven).toContain('из 11 коммитов за')
  })

  it('follows the whole history when there is nothing before the release', () => {
    const draft = draftNotes([commit('Add the first feature')], {
      fromTag: null,
      toTag: 'v0.2.0',
      repoUrl: 'https://example.test/repo',
    })

    expect(draft).toContain('за `v0.2.0`')
    expect(draft).not.toContain('compare')
  })

  it('writes plain hashes when the repository URL is unknown', () => {
    const draft = draftNotes([commit('feat: add a thing', '', 'ddddddd')], {
      fromTag: 'v0.8.3',
      toTag: 'v0.8.4',
      repoUrl: null,
    })

    expect(draft).toContain('- Add a thing (`ddddddd`)')
    expect(draft).not.toContain('null/commit')
    expect(draft).not.toContain('compare')
  })
})

describe('release notes draft: what it is compared against', () => {
  const tags = ['v0.8.4-rc.1', 'v0.8.3', 'v0.8.3-rc.4', 'v0.8.2', 'nightly', 'v1.2']

  it('compares a stable version against the previous stable release', () => {
    expect(previousTagFor(tags, '0.8.4')).toBe('v0.8.3')
    expect(previousTagFor(tags, '0.8.3')).toBe('v0.8.2')
  })

  it('compares a candidate against the previous tag of any kind', () => {
    expect(previousTagFor(tags, '0.8.4-rc.2')).toBe('v0.8.4-rc.1')
    expect(previousTagFor(tags, '0.8.4-rc.1')).toBe('v0.8.3')
  })

  it('ignores names that are not versions and says so when nothing is left', () => {
    expect(previousTagFor(['nightly', 'release'], '0.8.4')).toBeNull()
    expect(previousTagFor([], '0.8.4')).toBeNull()
  })
})

describe('release guard: a tag has to document its own version', () => {
  it('finds the entry the changelog generator writes before the tag', () => {
    const [entry] = pendingReleases(
      [file('v0.8.4.md', 'Стабильный релиз 0.8.4.')],
      hooks({ 'v0.8.4': '2026-09-21' }),
    )

    expect(missingChangelogEntry('v0.8.4', pendingSection(entry, 'https://example.test/repo'))).toBe(
      false,
    )
  })

  it('rejects a tree whose changelog never mentions the version', () => {
    expect(missingChangelogEntry('v0.8.3', '# Журнал\n\n## v0.8.2 — 2026-08-01\n')).toBe(true)
    expect(missingChangelogEntry('v0.8.3', '')).toBe(true)
    expect(missingChangelogEntry('v0.8.3', null)).toBe(true)
  })

  it('does not let a candidate stand in for the stable version', () => {
    const candidate = '<a id="v-0-8-4-rc-1"></a>'

    expect(missingChangelogEntry('v0.8.4-rc.1', candidate)).toBe(false)
    expect(missingChangelogEntry('v0.8.4', candidate)).toBe(true)
  })
})
