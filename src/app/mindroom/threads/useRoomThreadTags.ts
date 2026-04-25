import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useEffect, useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useStateEvents } from '../../hooks/useStateEvents';
import {
  aggregateThreadTagEvents,
  type TagMetadata,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  type ThreadTagsContent,
} from './threadTags';
import {
  clearPendingThreadTagsContent,
  getPendingThreadTagsContentMap,
  sameThreadTagsContent,
  usePendingThreadTagsVersion,
} from './threadTagPending';
import { useMutateThreadTags } from './useMutateThreadTags';

// ─── Resolution state types ─────────────────────────────────────────────────

export type ThreadResolutionState = {
  event?: MatrixEvent;
  tags: Record<string, TagMetadata> | null;
  isResolved: boolean;
  isPending: boolean;
};

const unresolvedState: ThreadResolutionState = {
  tags: null,
  isResolved: false,
  isPending: false,
};
const baseResolutionMapCache = new WeakMap<MatrixEvent[], Map<string, ThreadResolutionState>>();

// ─── Internal helpers ────────────────────────────────────────────────────────

const getThreadResolutionState = (content?: ThreadTagsContent): ThreadResolutionState => {
  if (content && Object.keys(content.tags).length > 0) {
    return {
      event: undefined,
      tags: content.tags,
      isResolved: isThreadResolved(content),
      isPending: false,
    };
  }

  return unresolvedState;
};

const getBaseResolutionMap = (events: MatrixEvent[]): Map<string, ThreadResolutionState> => {
  const cached = baseResolutionMapCache.get(events);
  if (cached) {
    return cached;
  }

  const aggregated = aggregateThreadTagEvents(events);
  const map = new Map<string, ThreadResolutionState>();
  aggregated.forEach((content, threadRootId) => {
    map.set(threadRootId, getThreadResolutionState(content));
  });

  baseResolutionMapCache.set(events, map);
  return map;
};

const applyPending = (
  state: ThreadResolutionState,
  pending?: ThreadTagsContent
): ThreadResolutionState => {
  if (!pending) return state;
  const tags = Object.keys(pending.tags).length > 0 ? pending.tags : null;
  return {
    ...state,
    tags,
    isResolved: isThreadResolved(pending),
    isPending: true,
  };
};

// ─── Hooks (pending version) ────────────────────────────────────────────────

const usePendingVersion = usePendingThreadTagsVersion;

// ─── Public hooks ───────────────────────────────────────────────────────────

export const useThreadResolution = (room: Room, threadRootId?: string): ThreadResolutionState => {
  const resolutionMap = useRoomThreadResolutionMap(room);

  return useMemo(
    () => (threadRootId ? resolutionMap.get(threadRootId) ?? unresolvedState : unresolvedState),
    [resolutionMap, threadRootId]
  );
};

export const useRoomThreadResolutionMap = (room: Room): Map<string, ThreadResolutionState> => {
  const events = useStateEvents(room, MINDROOM_THREAD_TAGS_EVENT);
  const pVersion = usePendingVersion();
  const pendingMap = useMemo(
    () => getPendingThreadTagsContentMap(room.roomId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, pVersion]
  );

  const resolutionMap = useMemo(() => {
    return getBaseResolutionMap(events);
  }, [events]);

  useEffect(() => {
    pendingMap.forEach((pend, threadRootId) => {
      const actual = resolutionMap.get(threadRootId);
      const actualContent = { tags: actual?.tags ?? {} };
      if (sameThreadTagsContent(actualContent, pend)) {
        clearPendingThreadTagsContent(room.roomId, threadRootId);
      }
    });
  }, [pendingMap, resolutionMap, room.roomId]);

  return useMemo(() => {
    if (pendingMap.size === 0) return resolutionMap;

    const next = new Map<string, ThreadResolutionState>(resolutionMap);
    pendingMap.forEach((pend, threadRootId) => {
      const current = next.get(threadRootId) ?? unresolvedState;
      next.set(threadRootId, applyPending(current, pend));
    });
    return next;
  }, [pendingMap, resolutionMap]);
};

export const useToggleThreadResolution = (room: Room) => {
  const { setResolved, updating, error } = useMutateThreadTags(room);
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canToggle = permissions.stateEvent(MINDROOM_THREAD_TAGS_EVENT, mx.getSafeUserId());

  return {
    canToggle,
    setResolved,
    updating,
    error: error ?? undefined,
  };
};
