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
