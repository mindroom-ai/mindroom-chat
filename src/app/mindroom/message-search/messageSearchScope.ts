import { SyncState } from 'matrix-js-sdk';

export type MessageSearchSyncStateData = {
  current: SyncState | null;
  previous: SyncState | null | undefined;
};

export const normalizeMessageSearchRooms = (rooms?: string[]): string[] | undefined => {
  if (!rooms) return undefined;

  return Array.from(new Set(rooms)).sort();
};

export const areMessageSearchRoomsEqual = (
  a?: string[],
  b?: string[]
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;

  return a.every((roomId, index) => roomId === b[index]);
};

export const isInitialMessageSearchCatchupInProgress = ({
  current,
  previous,
}: MessageSearchSyncStateData): boolean =>
  (current === SyncState.Prepared ||
    current === SyncState.Syncing ||
    current === SyncState.Catchup) &&
  previous !== SyncState.Syncing;

export const shouldDeferImplicitMessageSearch = ({
  hasTerm,
  global,
  hasExplicitRooms,
  implicitRoomsReady,
}: {
  hasTerm: boolean;
  global: boolean;
  hasExplicitRooms: boolean;
  implicitRoomsReady: boolean;
}): boolean =>
  hasTerm && !global && !hasExplicitRooms && !implicitRoomsReady;
