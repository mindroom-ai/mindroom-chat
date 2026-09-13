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
import { buildThreadResolvedContent, parseThreadResolutionContent } from './threadResolution';
import {
  PendingThreadResolution,
  clearPendingThreadResolution,
  setPendingThreadResolution,
  usePendingThreadResolution,
  usePendingThreadResolutionMap,
} from './threadResolutionPending';
import { getValidThreadRootEvent } from './threadUtils';

export type ThreadResolutionState = {
  event?: MatrixEvent;
  content?: ReturnType<typeof parseThreadResolutionContent>;
  isResolved: boolean;
  isPending: boolean;
};

const unresolvedState: ThreadResolutionState = {
  isResolved: false,
  isPending: false,
};

const getThreadResolutionState = (event?: MatrixEvent): ThreadResolutionState => {
  if (!event) return unresolvedState;

  const content = parseThreadResolutionContent(event.getContent(), event.getStateKey());
  if (!content) {
    return {
      event,
      isResolved: false,
      isPending: false,
    };
  }

  return {
    event,
    content,
    isResolved: true,
    isPending: false,
  };
};

const applyPendingThreadResolution = (
  state: ThreadResolutionState,
  pendingResolution?: PendingThreadResolution
): ThreadResolutionState => {
  if (!pendingResolution) return state;

  return {
    ...state,
    isResolved: pendingResolution.resolved,
    isPending: true,
  };
};

export const useThreadResolution = (room: Room, threadRootId?: string): ThreadResolutionState => {
  const event = useStateEvent(room, StateEvent.ThreadResolution, threadRootId ?? '');
  const pendingResolution = usePendingThreadResolution(room.roomId, threadRootId);

  const resolutionState = useMemo(
    () => (threadRootId ? getThreadResolutionState(event) : unresolvedState),
    [event, threadRootId]
  );

  useEffect(() => {
    if (!threadRootId || !pendingResolution) return;

    if (resolutionState.isResolved === pendingResolution.resolved) {
      clearPendingThreadResolution(room.roomId, threadRootId);
    }
  }, [pendingResolution, resolutionState.isResolved, room.roomId, threadRootId]);

  return useMemo(
    () => applyPendingThreadResolution(resolutionState, pendingResolution),
    [pendingResolution, resolutionState]
  );
};

export const useRoomThreadResolutionMap = (room: Room): Map<string, ThreadResolutionState> => {
  const events = useStateEvents(room, StateEvent.ThreadResolution);
  const pendingResolutionMap = usePendingThreadResolutionMap(room.roomId);

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
    pendingResolutionMap.forEach((pendingResolution, threadRootId) => {
      const actualResolutionState = resolutionMap.get(threadRootId);
      const isResolved = actualResolutionState?.isResolved ?? false;

      if (isResolved === pendingResolution.resolved) {
        clearPendingThreadResolution(room.roomId, threadRootId);
      }
    });
  }, [pendingResolutionMap, resolutionMap, room.roomId]);

  return useMemo(() => {
    if (pendingResolutionMap.size === 0) {
      return resolutionMap;
    }

    const nextResolutionMap = new Map<string, ThreadResolutionState>(resolutionMap);

    pendingResolutionMap.forEach((pendingResolution, threadRootId) => {
      const currentResolutionState = nextResolutionMap.get(threadRootId) ?? unresolvedState;
      nextResolutionMap.set(
        threadRootId,
        applyPendingThreadResolution(currentResolutionState, pendingResolution)
      );
    });

    return nextResolutionMap;
  }, [pendingResolutionMap, resolutionMap]);
};

export const useToggleThreadResolution = (room: Room) => {
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const userId = mx.getSafeUserId();
  const canToggle = permissions.stateEvent(StateEvent.ThreadResolution, userId);

  const [toggleState, sendThreadResolution] = useAsyncCallback(
    useCallback(
      async (threadRootId: string, resolved: boolean) => {
        const validThreadRootId = getValidThreadRootEvent(room, threadRootId)?.getId();
        if (!validThreadRootId) {
          throw new Error('Thread resolution is only available for known thread roots.');
        }

        const content = resolved ? buildThreadResolvedContent(validThreadRootId, userId) : {};

        await mx.sendStateEvent(
          room.roomId,
          StateEvent.ThreadResolution as any,
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
        setPendingThreadResolution(room.roomId, validThreadRootId, resolved);
      }

      try {
        await sendThreadResolution(threadRootId, resolved);
      } catch (err) {
        // Don't clear pending state when another request replaced this one —
        // the replacement owns the pending state now.
        const replaced =
          err instanceof Error && err.message === 'AsyncCallbackHook: Request replaced!';
        if (validThreadRootId && !replaced) {
          clearPendingThreadResolution(room.roomId, validThreadRootId);
        }
      }
    },
    [room, sendThreadResolution]
  );

  return {
    canToggle,
    setResolved,
    updating: toggleState.status === AsyncStatus.Loading,
    error: toggleState.status === AsyncStatus.Error ? (toggleState.error as Error) : undefined,
  };
};
