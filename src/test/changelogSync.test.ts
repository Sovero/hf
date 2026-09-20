import { describe, expect, it } from 'vitest'
import { MAX_PER_SECTION, entryOf, isNoise, notesFromCommits } from '../../scripts/sync-changelog.mjs'

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
