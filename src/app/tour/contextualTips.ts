import { isRoomVisible } from '../matrix/state/archivedRooms';
import type { TourStepId } from '../navigation/tourState';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';

export const RESOLVE_TIP_ID = 'resolve_threads';
export const RESOLVE_TIP_MIN_OPEN = 5;
export const RESOLVE_TIP_MIN_OLD = 3;
export const RESOLVE_TIP_OLD_AGE_MS = 24 * 60 * 60 * 1000;

export type ContextualTipId = typeof RESOLVE_TIP_ID;

export type ContextualTip = {
  id: ContextualTipId;
  tourStep: TourStepId;
  scope: 'room' | 'all';
  openCount: number;
};

export type EvaluateContextualTipInput = {
  entries: Iterable<CrossRoomThreadIndexEntry>;
  selectedRoomId?: string;
  archivedRooms: ReadonlySet<string>;
  dismissedTips: ReadonlySet<string>;
  now: number;
  /** Whether the user can write thread resolution tags in `roomId`; defaults to true when omitted. */
  canResolveRoom?: (roomId: string) => boolean;
};

/**
 * Evaluates whether a contextual UI tip currently applies to the account's threads.
 * Suggests resolving finished threads once open non-snoozed threads accumulate in rooms where the
 * user can resolve threads, without any thread in visible rooms having been resolved yet.
 */
export const evaluateContextualTip = ({
  entries,
  selectedRoomId,
  archivedRooms,
  dismissedTips,
  now,
  canResolveRoom,
}: EvaluateContextualTipInput): ContextualTip | undefined => {
  if (dismissedTips.has(RESOLVE_TIP_ID)) return undefined;

  const canResolveCache = canResolveRoom ? new Map<string, boolean>() : undefined;
  const isRoomResolvable = (roomId: string): boolean => {
    if (!canResolveRoom || !canResolveCache) return true;
    const cached = canResolveCache.get(roomId);
    if (cached !== undefined) return cached;
    const allowed = canResolveRoom(roomId);
    canResolveCache.set(roomId, allowed);
    return allowed;
  };

  let totalOpen = 0;
  let totalOld = 0;
  let roomOpen = 0;
  let roomOld = 0;

  for (const entry of entries) {
    if (!isRoomVisible(entry.roomId, archivedRooms)) continue;
    if (entry.isResolved) return undefined;
    if (entry.snoozedUntilTs !== undefined && entry.snoozedUntilTs > now) continue;
    if (!isRoomResolvable(entry.roomId)) continue;

    const isOld = now - entry.lastActivityTs >= RESOLVE_TIP_OLD_AGE_MS;
    totalOpen += 1;
    if (isOld) totalOld += 1;
    if (selectedRoomId !== undefined && entry.roomId === selectedRoomId) {
      roomOpen += 1;
      if (isOld) roomOld += 1;
    }
  }

  if (
    selectedRoomId !== undefined &&
    (roomOpen >= RESOLVE_TIP_MIN_OPEN || roomOld >= RESOLVE_TIP_MIN_OLD)
  ) {
    return {
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'room',
      openCount: roomOpen,
    };
  }

  if (totalOpen >= RESOLVE_TIP_MIN_OPEN || totalOld >= RESOLVE_TIP_MIN_OLD) {
    return {
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: totalOpen,
    };
  }

  return undefined;
};
