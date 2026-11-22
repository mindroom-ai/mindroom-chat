import type { MatrixEvent } from 'matrix-js-sdk';
import { isRowlessTimelineEvent } from '../event-store/timeline/timelineRowTypes';
import type { TimelineEventEntry } from '../event-store/timeline/roomTimelineEvents';
import type { TimelineRange } from '../event-store/timeline/timelinePagination';
import { getMemberEventKindForEvent, type MemberEventKind } from '../messages/useMemberEventParser';

/** Fewer consecutive membership events than this stay ungrouped. */
export const MIN_FOLDED_MEMBERSHIP_EVENTS = 3;

export type MembershipFoldSummary = {
  total: number;
  joined: number;
  left: number;
  invited: number;
  requested: number;
  kicked: number;
  banned: number;
  unbanned: number;
  profileChanges: number;
};

export type MembershipFold = {
  /** The ID of the run's first event, whose row draws the fold's break. */
  key: string;
  /** The IDs of the run's events, in timeline order. */
  eventIds: readonly string[];
  /**
   * The IDs of every loaded event from the run's first to its last: its events and the rowless
   * and skipped ones between them, which a closed fold holds with them.
   */
  spanIds: readonly string[];
  /** Total event count and deduplicated user tallies per category. */
  summary: MembershipFoldSummary;
};

export type MembershipFoldRules = {
  /** Events hidden by other timeline rules that pass through without breaking a run. */
  isSkipped: (event: MatrixEvent) => boolean;
  /** Event IDs that must stay visible (route or jump targets). */
  pinnedIds: ReadonlySet<string>;
};

export type MembershipFoldState = { fold: MembershipFold; open: boolean };

/** The room's folds, each by the ID of its first event. */
export type MembershipFoldView = {
  breaks: ReadonlyMap<string, MembershipFoldState>;
};

export const EMPTY_MEMBERSHIP_FOLD_VIEW: MembershipFoldView = { breaks: new Map() };

type SummaryBucketKey = Exclude<keyof MembershipFoldSummary, 'total'>;

const bucketForMemberKind = (kind: MemberEventKind): SummaryBucketKey | undefined => {
  switch (kind) {
    case 'joined':
      return 'joined';
    case 'left':
      return 'left';
    case 'invited':
    case 'acceptedRequest':
      return 'invited';
    case 'requested':
      return 'requested';
    case 'kicked':
      return 'kicked';
    case 'banned':
      return 'banned';
    case 'unbanned':
      return 'unbanned';
    case 'changedName':
    case 'removedName':
    case 'changedAvatar':
    case 'removedAvatar':
      return 'profileChanges';
    default:
      return undefined;
  }
};

export const isFoldableMembershipEvent = (event: MatrixEvent): boolean =>
  event.getType() === 'm.room.member' && event.getStateKey() !== undefined;

/**
 * Counts a run's events as their rows read: each by the sentence `useMemberEventParser` gives it.
 * A redacted event, which shows only with hidden events, keeps its `membership`, so its row still
 * reads as a ban, an invitation or a request, and it counts as one.
 */
export const summarizeMembershipRun = (events: readonly MatrixEvent[]): MembershipFoldSummary => {
  const buckets: Record<SummaryBucketKey, Set<string>> = {
    joined: new Set(),
    left: new Set(),
    invited: new Set(),
    requested: new Set(),
    kicked: new Set(),
    banned: new Set(),
    unbanned: new Set(),
    profileChanges: new Set(),
  };

  for (const event of events) {
    const bucket = bucketForMemberKind(getMemberEventKindForEvent(event));
    if (bucket) {
      buckets[bucket].add(event.getStateKey() ?? '');
    }
  }

  return {
    total: events.length,
    joined: buckets.joined.size,
    left: buckets.left.size,
    invited: buckets.invited.size,
    requested: buckets.requested.size,
    kicked: buckets.kicked.size,
    banned: buckets.banned.size,
    unbanned: buckets.unbanned.size,
    profileChanges: buckets.profileChanges.size,
  };
};

/**
 * Plans folds for consecutive visible `m.room.member` events across the full loaded room rows.
 * Day changes do not split a run; room state changes (name, topic, avatar) and messages do.
 * Rowless and skipped events pass through without splitting a run, and any run with a pinned
 * event ID stays unfolded, whether the ID is of one of its events or of one passed over between
 * them: a jump to that one finds no row of its own, and lands where it would show.
 */
export const planMembershipFolds = (
  events: readonly MatrixEvent[],
  rules: MembershipFoldRules
): MembershipFold[] => {
  const folds: MembershipFold[] = [];
  let run: MatrixEvent[] = [];
  let spanIds: string[] = [];
  // Passed over since the run's last event: in its span once another event of the run follows.
  let passedIds: string[] = [];

  const flush = () => {
    if (run.length >= MIN_FOLDED_MEMBERSHIP_EVENTS) {
      const eventIds = run.flatMap((event) => event.getId() ?? []);
      const key = eventIds[0];
      if (key && eventIds.length === run.length && !spanIds.some((id) => rules.pinnedIds.has(id))) {
        folds.push({
          key,
          eventIds,
          spanIds: spanIds.length === eventIds.length ? eventIds : spanIds,
          summary: summarizeMembershipRun(run),
        });
      }
    }
    run = [];
    spanIds = [];
    passedIds = [];
  };

  for (const event of events) {
    const id = event.getId();
    if (!id) continue;
    if (isRowlessTimelineEvent(event) || rules.isSkipped(event)) {
      if (run.length > 0) passedIds.push(id);
    } else if (isFoldableMembershipEvent(event)) {
      run.push(event);
      spanIds.push(...passedIds, id);
      passedIds = [];
    } else {
      flush();
    }
  }
  flush();

  return folds;
};

export const viewMembershipFolds = (
  folds: readonly MembershipFold[],
  isOpen: (fold: MembershipFold) => boolean
): MembershipFoldView => {
  if (folds.length === 0) return EMPTY_MEMBERSHIP_FOLD_VIEW;
  const breaks = new Map<string, MembershipFoldState>();
  for (const fold of folds) breaks.set(fold.key, { fold, open: isOpen(fold) });
  return { breaks };
};

/**
 * The room's rows as the timeline lists them: every loaded row, with each closed fold as one row.
 * The window, the virtual list and every jump count in these rows, so no row of the list is
 * hidden and no window can start or end inside a closed fold. The timeline's state keeps counting
 * in loaded rows (`timeline.range`), which history pages, live rows and removed rows move.
 */
export type RoomRowProjection = {
  /** A closed fold's row holds the fold's first event. */
  rows: MatrixEvent[];
  /**
   * The rows' places in the loaded timeline. A closed fold's row stands at its last event: a
   * read marker anywhere before that one leaves part of the fold unread.
   */
  entries: TimelineEventEntry[];
  /** How many loaded rows the rows stand for. */
  loadedCount: number;
  /** Each row's first loaded row. Without a closed fold the rows are the loaded rows: undefined. */
  loadedStarts?: readonly number[];
  /**
   * The row of each loaded event a closed fold holds, by its ID: the fold's events, its first one
   * too, and the rowless and skipped ones between them.
   */
  foldedRows: ReadonlyMap<string, number>;
};

const NO_FOLDED_ROWS: ReadonlyMap<string, number> = new Map();

/**
 * Lists the loaded rows with each closed fold as one row. A fold's run reaches from its first
 * event to its last: the rowless and hidden events between them, which draw nothing, go with it.
 */
export const projectRoomRows = (
  events: MatrixEvent[],
  entries: TimelineEventEntry[],
  view: MembershipFoldView
): RoomRowProjection => {
  let closed = false;
  view.breaks.forEach(({ open }) => {
    if (!open) closed = true;
  });
  if (!closed) {
    return { rows: events, entries, loadedCount: events.length, foldedRows: NO_FOLDED_ROWS };
  }
  // As where the rows are read by their index: the entries pair with the events.
  const paired = entries.length === events.length;
  const rows: MatrixEvent[] = [];
  const rowEntries: TimelineEventEntry[] = [];
  const loadedStarts: number[] = [];
  const foldedRows = new Map<string, number>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    const state = view.breaks.get(event.getId() ?? '');
    const lastId = state && !state.open ? state.fold.eventIds.at(-1) : undefined;
    let last = index;
    if (state && lastId) {
      while (last < events.length && events[last]?.getId() !== lastId) last += 1;
      // A fold of other rows than these: its first event is a row of its own.
      if (last === events.length) last = index;
      else {
        for (let held = index; held <= last; held += 1) {
          const heldId = events[held]?.getId();
          if (heldId) foldedRows.set(heldId, rows.length);
        }
      }
    }
    loadedStarts.push(index);
    rows.push(event);
    const entry = entries[index];
    const lastEntry = entries[last];
    if (paired && entry && lastEntry) {
      rowEntries.push(last === index ? entry : { event, absoluteIndex: lastEntry.absoluteIndex });
    }
    index = last;
  }
  return {
    rows,
    entries: paired ? rowEntries : entries,
    loadedCount: events.length,
    loadedStarts,
    foldedRows,
  };
};

/** The row that holds the loaded row at `loadedIndex`; past the last loaded row, the row count. */
export const rowIndexOfLoaded = (
  { loadedStarts, loadedCount, rows }: RoomRowProjection,
  loadedIndex: number
): number => {
  if (!loadedStarts) return loadedIndex;
  if (loadedIndex >= loadedCount) return rows.length;
  let low = 0;
  let high = loadedStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((loadedStarts[middle] ?? 0) <= loadedIndex) low = middle;
    else high = middle - 1;
  }
  return low;
};

/**
 * The rows that hold the loaded rows of `range`. A closed fold the range starts or ends inside
 * is in it whole: a page of history can bring earlier events of the run a window starts with.
 */
export const rowRangeOfLoaded = (
  projection: RoomRowProjection,
  range: TimelineRange
): TimelineRange => {
  if (!projection.loadedStarts) return range;
  const start = rowIndexOfLoaded(projection, Math.max(range.start, 0));
  if (range.end <= range.start) return { start, end: start };
  return { start, end: rowIndexOfLoaded(projection, range.end - 1) + 1 };
};

/** The loaded rows the rows of `range` stand for. */
export const loadedRangeOfRows = (
  { loadedStarts, loadedCount }: RoomRowProjection,
  range: TimelineRange
): TimelineRange => {
  if (!loadedStarts) return range;
  const loadedIndex = (row: number) =>
    row >= loadedStarts.length ? loadedCount : loadedStarts[Math.max(row, 0)] ?? loadedCount;
  return { start: loadedIndex(range.start), end: loadedIndex(range.end) };
};

/** The height the list gave each row of the window it last rendered, by event ID. */
export type FoldedRowSizes = ReadonlyMap<string, number>;

/**
 * The height of the rows of the last render that a fold now holds, or 0 when it held none: the
 * rows of its events, and those of the events between them that had a row then.
 */
export const heldFoldHeight = (sizes: FoldedRowSizes, fold: MembershipFold): number => {
  if (sizes.size === 0) return 0;
  let px = 0;
  for (const id of fold.spanIds) px += sizes.get(id) ?? 0;
  return px;
};

/** The room's list as it last rendered: what a fold that forms over its rows takes the place of. */
export type RenderedRoomRows = {
  sizes: FoldedRowSizes;
  /** The folds of that render. */
  view: MembershipFoldView;
  /** The list's own record of the heights it measured, by row key, which it lays rows out by. */
  measured?: Map<string | number | bigint, number>;
};

/**
 * Whether a closed fold took the place of rows of the last render beside its first event's own:
 * it formed over them, or grew over them. A fold the reader closed did too, but its row is on
 * screen and measures itself: not that one.
 */
export const foldFormedOverRows = (
  { sizes, view: before }: RenderedRoomRows,
  { fold, open }: MembershipFoldState
): boolean =>
  !open &&
  before.breaks.get(fold.key)?.open !== true &&
  fold.spanIds.some((id) => id !== fold.key && sizes.has(id));
