/**
 * The thread filter bar's Tags dropdown: the tags it lists, in which order, and its search.
 */
import type { TriState } from '../../event-store/threads/roomThreadOverviewModel';
import { RESOLVED_TAG, SNOOZED_TAG } from '../../event-store/threads/threadTags';

export type ThreadTagOption = {
  tag: string;
  /** How many of the room's threads carry the tag. */
  count: number;
  /** The tag's filter: 'include' keeps the threads that carry it, 'exclude' hides them. */
  state: TriState;
};

/**
 * Every tag of the room's threads, most used first and then by name. A tag the filter names that
 * no thread carries any more stays listed, so its choice can be undone. Resolved is left out: the
 * status filter covers it, and a thread's tags for filtering never include it, so choosing it here
 * would hide every thread.
 */
export const buildThreadTagOptions = (
  tags: readonly string[],
  counts: Readonly<Record<string, number>> | undefined,
  filters: ReadonlyMap<string, TriState>
): ThreadTagOption[] =>
  [
    ...new Set([
      ...tags.filter((tag) => tag !== RESOLVED_TAG && tag !== SNOOZED_TAG),
      ...filters.keys(),
    ]),
  ]
    .map((tag) => ({ tag, count: counts?.[tag] ?? 0, state: filters.get(tag) ?? 'any' }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

/** The dropdown's search: a tag matches when its name contains the query, in any case. */
export const matchesThreadTagSearch = (tag: string, query: string): boolean =>
  tag.toLowerCase().includes(query.trim().toLowerCase());
