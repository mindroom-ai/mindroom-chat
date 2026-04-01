import { EventTimeline } from 'matrix-js-sdk';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCallback, useEffect, useMemo } from 'react';
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
  type ThreadTagsContent,
} from './threadTags';
import { getValidThreadRootEvent } from './threadUtils';
import {
  clearPendingThreadTagsContent,
  getPendingThreadTagsContent,
  getPendingThreadTagsContentMap,
  sameThreadTagsContent,
  setPendingThreadTagsContent,
  usePendingThreadTagsVersion,
} from './threadTagPending';

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

const getThreadResolutionState = (event?: MatrixEvent): ThreadResolutionState => {
  if (event) {
    const content = parseThreadTagsContent(event.getContent());
    const tags = Object.keys(content.tags).length > 0 ? content.tags : null;
    const isResolved = isThreadResolved(content);
    return { event, tags, isResolved, isPending: false };
  }

  return unresolvedState;
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
  const event = useStateEvent(room, StateEvent.ThreadTags, threadRootId ?? '');
  const pVersion = usePendingVersion();
  const pending = useMemo(
    () => (threadRootId ? getPendingThreadTagsContent(room.roomId, threadRootId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, threadRootId, pVersion]
  );

  const resolutionState = useMemo(
    () => (threadRootId ? getThreadResolutionState(event) : unresolvedState),
    [event, threadRootId]
  );

  useEffect(() => {
    if (!threadRootId || !pending) return;
    const actualContent = { tags: resolutionState.tags ?? {} };
    if (sameThreadTagsContent(actualContent, pending)) {
      clearPendingThreadTagsContent(room.roomId, threadRootId);
    }
  }, [pending, resolutionState.tags, room.roomId, threadRootId]);

  return useMemo(
    () => applyPending(resolutionState, pending),
    [pending, resolutionState]
  );
};

export const useRoomThreadResolutionMap = (room: Room): Map<string, ThreadResolutionState> => {
  const events = useStateEvents(room, StateEvent.ThreadTags);
  const pVersion = usePendingVersion();
  const pendingMap = useMemo(
    () => getPendingThreadTagsContentMap(room.roomId),
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
    return map;
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

        setPendingThreadTagsContent(room.roomId, validThreadRootId, content);

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
      try {
        await sendThreadTags(threadRootId, resolved);
      } catch (err) {
        const replaced =
          err instanceof Error && err.message === 'AsyncCallbackHook: Request replaced!';
        if (validThreadRootId && !replaced) {
          clearPendingThreadTagsContent(room.roomId, validThreadRootId);
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
