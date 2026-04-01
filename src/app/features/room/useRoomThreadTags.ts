import { EventTimeline } from 'matrix-js-sdk';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useStateEvents } from '../../hooks/useStateEvents';
import { StateEvent } from '../../../types/matrix/room';
import {
  type TagMetadata,
  parseThreadTagsContent,
  buildResolvedTagsContent,
  buildUnresolvedTagsContent,
  isThreadResolved,
} from './threadTags';
import { getValidThreadRootEvent } from './threadUtils';

// ─── Pending tag state (optimistic UI) ───────────────────────────────────────

type PendingThreadTag = {
  resolved: boolean;
};

const PENDING_TIMEOUT_MS = 15000;
const pendingTags = new Map<string, PendingThreadTag>();
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const pendingListeners = new Set<() => void>();
let pendingVersion = 0;

const pendingKey = (roomId: string, threadRootId: string): string =>
  `${roomId}\0${threadRootId}`;

const emitPendingChange = () => {
  pendingVersion += 1;
  pendingListeners.forEach((l) => l());
};

const clearPendingTimeout = (key: string) => {
  const t = pendingTimeouts.get(key);
  if (t !== undefined) {
    clearTimeout(t);
    pendingTimeouts.delete(key);
  }
};

const subscribePending = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

const getPendingVersion = () => pendingVersion;

const setPendingTag = (
  roomId: string,
  threadRootId: string,
  resolved: boolean
) => {
  const key = pendingKey(roomId, threadRootId);
  clearPendingTimeout(key);
  pendingTags.set(key, { resolved });
  pendingTimeouts.set(
    key,
    setTimeout(() => {
      clearPendingTag(roomId, threadRootId);
    }, PENDING_TIMEOUT_MS)
  );
  emitPendingChange();
};

const clearPendingTag = (roomId: string, threadRootId: string) => {
  const key = pendingKey(roomId, threadRootId);
  const had = pendingTags.delete(key);
  clearPendingTimeout(key);
  if (had) emitPendingChange();
};

const getPendingTag = (
  roomId: string,
  threadRootId: string
): PendingThreadTag | undefined => pendingTags.get(pendingKey(roomId, threadRootId));

const getPendingTagMap = (roomId: string): Map<string, PendingThreadTag> => {
  const prefix = `${roomId}\0`;
  const result = new Map<string, PendingThreadTag>();
  pendingTags.forEach((tag, key) => {
    if (key.startsWith(prefix)) {
      result.set(key.slice(prefix.length), tag);
    }
  });
  return result;
};

// ─── Legacy fallback ─────────────────────────────────────────────────────────

/**
 * Legacy state event type used before the thread-tags migration.
 * Rooms that predate the migration may only have this event for some threads.
 * Content shape: `{ resolved: boolean }`.
 */
const LEGACY_THREAD_RESOLUTION = 'com.mindroom.thread.resolution' as unknown as StateEvent;

export const parseLegacyResolutionContent = (
  content: unknown
): { isResolved: boolean; tags: Record<string, TagMetadata> | null } | null => {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null;
  const c = content as Record<string, unknown>;
  if (typeof c.resolved !== 'boolean') return null;
  const isResolved = c.resolved;
  return {
    isResolved,
    tags: isResolved
      ? { resolved: { set_by: 'legacy', set_at: 0 } }
      : null,
  };
};

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

// ─── Internal helpers ────────────────────────────────────────────────────────

const getThreadResolutionState = (
  event?: MatrixEvent,
  legacyEvent?: MatrixEvent
): ThreadResolutionState => {
  if (event) {
    const content = parseThreadTagsContent(event.getContent());
    const tags = Object.keys(content.tags).length > 0 ? content.tags : null;
    const isResolved = isThreadResolved(content);
    return { event, tags, isResolved, isPending: false };
  }

  if (legacyEvent) {
    const legacy = parseLegacyResolutionContent(legacyEvent.getContent());
    if (legacy) {
      return {
        event: legacyEvent,
        tags: legacy.tags,
        isResolved: legacy.isResolved,
        isPending: false,
      };
    }
  }

  return unresolvedState;
};

const applyPending = (
  state: ThreadResolutionState,
  pending?: PendingThreadTag
): ThreadResolutionState => {
  if (!pending) return state;
  return {
    ...state,
    isResolved: pending.resolved,
    isPending: true,
  };
};

// ─── Hooks (pending version) ────────────────────────────────────────────────

const usePendingVersion = () =>
  useSyncExternalStore(subscribePending, getPendingVersion, getPendingVersion);

// ─── Public hooks ───────────────────────────────────────────────────────────

export const useThreadResolution = (room: Room, threadRootId?: string): ThreadResolutionState => {
  const event = useStateEvent(room, StateEvent.ThreadTags, threadRootId ?? '');
  const legacyEvent = useStateEvent(room, LEGACY_THREAD_RESOLUTION, threadRootId ?? '');
  const pVersion = usePendingVersion();
  const pending = useMemo(
    () => (threadRootId ? getPendingTag(room.roomId, threadRootId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, threadRootId, pVersion]
  );

  const resolutionState = useMemo(
    () => (threadRootId ? getThreadResolutionState(event, legacyEvent) : unresolvedState),
    [event, legacyEvent, threadRootId]
  );

  useEffect(() => {
    if (!threadRootId || !pending) return;
    if (resolutionState.isResolved === pending.resolved) {
      clearPendingTag(room.roomId, threadRootId);
    }
  }, [pending, resolutionState.isResolved, room.roomId, threadRootId]);

  return useMemo(
    () => applyPending(resolutionState, pending),
    [pending, resolutionState]
  );
};

export const useRoomThreadResolutionMap = (room: Room): Map<string, ThreadResolutionState> => {
  const events = useStateEvents(room, StateEvent.ThreadTags);
  const legacyEvents = useStateEvents(room, LEGACY_THREAD_RESOLUTION);
  const pVersion = usePendingVersion();
  const pendingMap = useMemo(
    () => getPendingTagMap(room.roomId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, pVersion]
  );

  const resolutionMap = useMemo(() => {
    const map = new Map<string, ThreadResolutionState>();
    events.forEach((event) => {
      const stateKey = event.getStateKey();
      if (!stateKey) return;
      map.set(stateKey, getThreadResolutionState(event));
    });
    // Backfill from legacy events for threads without a new-format event
    legacyEvents.forEach((legacyEvent) => {
      const stateKey = legacyEvent.getStateKey();
      if (!stateKey || map.has(stateKey)) return;
      map.set(stateKey, getThreadResolutionState(undefined, legacyEvent));
    });
    return map;
  }, [events, legacyEvents]);

  useEffect(() => {
    pendingMap.forEach((pend, threadRootId) => {
      const actual = resolutionMap.get(threadRootId);
      const isResolved = actual?.isResolved ?? false;
      if (isResolved === pend.resolved) {
        clearPendingTag(room.roomId, threadRootId);
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
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const userId = mx.getSafeUserId();
  const canToggle = permissions.stateEvent(StateEvent.ThreadTags, userId);

  const [toggleState, sendThreadTags] = useAsyncCallback(
    useCallback(
      async (threadRootId: string, resolved: boolean) => {
        const validThreadRootId = getValidThreadRootEvent(room, threadRootId)?.getId();
        if (!validThreadRootId) {
          throw new Error('Thread tags are only available for known thread roots.');
        }

        // Read current tags to preserve other tags when toggling resolved
        const currentEvent = room
          .getLiveTimeline()
          .getState(EventTimeline.FORWARDS)
          ?.getStateEvents(StateEvent.ThreadTags as string, validThreadRootId);
        const currentTags = currentEvent
          ? parseThreadTagsContent(currentEvent.getContent())
          : { tags: {} };

        const content = resolved
          ? buildResolvedTagsContent(currentTags, userId)
          : buildUnresolvedTagsContent(currentTags);

        await mx.sendStateEvent(
          room.roomId,
          StateEvent.ThreadTags as any,
          content,
          validThreadRootId
        );
      },
      [mx, room, room.roomId, userId]
    )
  );

  const setResolved = useCallback(
    async (threadRootId: string, resolved: boolean) => {
      const validThreadRootId = getValidThreadRootEvent(room, threadRootId)?.getId();
      if (validThreadRootId) {
        setPendingTag(room.roomId, validThreadRootId, resolved);
      }

      try {
        await sendThreadTags(threadRootId, resolved);
      } catch (err) {
        const replaced =
          err instanceof Error && err.message === 'AsyncCallbackHook: Request replaced!';
        if (validThreadRootId && !replaced) {
          clearPendingTag(room.roomId, validThreadRootId);
        }
      }
    },
    [room, sendThreadTags]
  );

  return {
    canToggle,
    setResolved,
    updating: toggleState.status === AsyncStatus.Loading,
    error: toggleState.status === AsyncStatus.Error ? (toggleState.error as Error) : undefined,
  };
};
