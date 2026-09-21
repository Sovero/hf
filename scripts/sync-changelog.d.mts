/** One commit, reduced to what a changelog entry needs. */
export interface CommitRecord {
  hash: string
  subject: string
  body: string
}

export type SectionId =
  | 'breaking'
  | 'feat'
  | 'fix'
  | 'perf'
  | 'ui'
  | 'internal'
  | 'docs'
  | 'tools'
  | 'other'

export interface ChangelogEntry {
  section: SectionId
  text: string
  hash: string
}

export declare const MAX_PER_SECTION: number

/** True for commit subjects that only shuffle version numbers. */
export declare function isNoise(subject: string): boolean

/** A commit → the section it belongs to and how its entry reads. */
export declare function entryOf(commit: CommitRecord): ChangelogEntry

/** Notes for a release that has none of its own, built from its commits. */
export declare function notesFromCommits(
  commits: CommitRecord[],
  range: { fromTag: string | null; toTag: string; widened?: boolean; repoUrl: string },
): string

/**
 * First line of a notes file that was generated rather than written. Both
 * release scripts refuse to cut or publish while this marker is still there.
 */
export declare const DRAFT_MARKER: string

/** Draft notes for a version that has no notes file yet — sections from the commits. */
export declare function draftNotes(
  commits: CommitRecord[],
  range: { fromTag: string | null; toTag: string; repoUrl: string | null; withCompareLink?: boolean },
): string

/** Commits between two revisions, noise dropped — the material of a draft. */
export declare function rangeCommits(fromRev: string | null, toRev: string): CommitRecord[]

/**
 * The release a version is compared against: a candidate against the previous
 * tag of any kind, a stable version against the previous stable tag.
 */
export declare function previousTagFor(tags: string[], version: string): string | null

/** A notes file from `release-notes/`, as read from disk. */
export interface NotesFile {
  name: string
  body: string
}

/** A version whose notes are written in the repository but whose release does not exist yet. */
export interface PendingRelease {
  tag: string
  version: string
  notes: string
  prerelease: boolean
  date: string
  channel: string
}

/** Git lookups the pending pass needs, injected so it can be tested without a repository. */
export interface PendingHooks {
  dateOf: (tag: string) => string
  hasTag: (tag: string) => boolean
}

/** Tag of a notes file, or null when the name is not a tag (`README.md`, `draft.md`). */
export declare function versionFromNotesFile(fileName: string): string | null

/** Entries for versions whose notes are in the repository but not on GitHub yet, newest first. */
export declare function pendingReleases(
  files: NotesFile[],
  hooks: PendingHooks,
): PendingRelease[]

/** Notes of versions that are already released — the release body wins; `differs` flags a stale file. */
export declare function pendingShadowedBy(
  pending: PendingRelease[],
  releases: { tag_name: string; body?: string | null }[],
): { tag: string; differs: boolean }[]

/** Index row of a version that has a changelog entry but no release page yet. */
export declare function pendingRow(release: PendingRelease): string

/** Changelog section of a version whose notes live in the repository. */
export declare function pendingSection(release: PendingRelease, repoUrl: string): string
