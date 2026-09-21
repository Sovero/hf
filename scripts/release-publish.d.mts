/**
 * Whether a tagged tree's changelog fails to document this version. The entry
 * is written before the tag, so a tag cut the old way has none.
 */
export declare function missingChangelogEntry(
  tag: string,
  changelog: string | null | undefined,
): boolean
