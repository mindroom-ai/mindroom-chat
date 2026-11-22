import type { MatrixEvent } from 'matrix-js-sdk';
import { isRowlessTimelineEvent } from '../event-store/timeline/timelineRowTypes';
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
  /** First event ID in the run, used as an anchor when opening the fold. */
  key: string;
  /** Folded event IDs in timeline order. */
  hiddenIds: readonly string[];
  /** Total event count and deduplicated user tallies per category. */
  summary: MembershipFoldSummary;
};

export type MembershipFoldRules = {
  /** Events hidden by other timeline rules that pass through without breaking a run. */
  isSkipped: (event: MatrixEvent) => boolean;
  /** Event IDs that must stay visible (route or jump targets). */
  pinnedIds: ReadonlySet<string>;
};

export type MembershipFoldView = {
  /** Rows of closed folds that render nothing and measure as 0 px. */
  hiddenIds: ReadonlySet<string>;
  /** Each fold's break pill, keyed by the row ID that draws it. */
  breaks: ReadonlyMap<string, { fold: MembershipFold; open: boolean }>;
  /** Every folded event ID mapped to its owning fold and open state. */
  foldByEventId: ReadonlyMap<string, { fold: MembershipFold; open: boolean }>;
};

export const EMPTY_MEMBERSHIP_FOLD_VIEW: MembershipFoldView = {
  hiddenIds: new Set(),
  breaks: new Map(),
  foldByEventId: new Map(),
};

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
    if (event.isRedacted()) continue;
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
 * Rowless and skipped events pass through without splitting a run, and any run containing a
 * pinned event ID stays unfolded.
 */
export const planMembershipFolds = (
  events: readonly MatrixEvent[],
  rules: MembershipFoldRules
): MembershipFold[] => {
  const folds: MembershipFold[] = [];
  let run: MatrixEvent[] = [];

  const flush = () => {
    if (run.length >= MIN_FOLDED_MEMBERSHIP_EVENTS) {
      const hiddenIds = run.flatMap((event) => event.getId() ?? []);
      const key = hiddenIds[0];
      if (
        key &&
        hiddenIds.length === run.length &&
        !hiddenIds.some((id) => rules.pinnedIds.has(id))
      ) {
        folds.push({
          key,
          hiddenIds,
          summary: summarizeMembershipRun(run),
        });
      }
    }
    run = [];
  };

  for (const event of events) {
    if (!event.getId() || isRowlessTimelineEvent(event) || rules.isSkipped(event)) {
      continue;
    }
    if (isFoldableMembershipEvent(event)) {
      run.push(event);
    } else {
      flush();
    }
  }
  flush();

  return folds;
};

/**
 * Projects planned membership folds into the hidden row IDs and break row placements for the
 * current window. When `visibleIds` is given, each fold's pill anchors on the first folded row
 * present in the window (falling back to the run's first row when the run is outside the window).
 */
export const viewMembershipFolds = (
  folds: readonly MembershipFold[],
  isOpen: (fold: MembershipFold) => boolean,
  visibleIds?: ReadonlySet<string>
): MembershipFoldView => {
  if (folds.length === 0) return EMPTY_MEMBERSHIP_FOLD_VIEW;
  const hiddenIds = new Set<string>();
  const breaks = new Map<string, { fold: MembershipFold; open: boolean }>();
  const foldByEventId = new Map<string, { fold: MembershipFold; open: boolean }>();

  for (const fold of folds) {
    const open = isOpen(fold);
    const entry = { fold, open };
    const breakRowId =
      (visibleIds ? fold.hiddenIds.find((id) => visibleIds.has(id)) : undefined) ??
      fold.hiddenIds[0];
    for (const id of fold.hiddenIds) {
      foldByEventId.set(id, entry);
      if (!open && id !== breakRowId) hiddenIds.add(id);
    }
    if (breakRowId) {
      breaks.set(breakRowId, entry);
    }
  }

  return { hiddenIds, breaks, foldByEventId };
};

/**
 * Resolves a room row index (such as the opening unread scroll anchor) so that if the target
 * event is hidden inside a closed membership fold, scrolling lands on that fold's break row.
 */
export const resolveMembershipFoldAnchorIndex = (
  events: readonly MatrixEvent[],
  index: number | undefined,
  view: MembershipFoldView
): number | undefined => {
  if (index === undefined) return undefined;
  const eventId = events[index]?.getId();
  if (!eventId || !view.hiddenIds.has(eventId)) return index;
  const entry = view.foldByEventId.get(eventId);
  if (!entry || entry.open) return index;
  for (const [breakRowId, breakEntry] of view.breaks) {
    if (breakEntry.fold === entry.fold) {
      const breakIndex = events.findIndex((event) => event.getId() === breakRowId);
      return breakIndex >= 0 ? breakIndex : index;
    }
  }
  return index;
};
