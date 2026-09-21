import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useStateEvents } from './useStateEvents';
import {
  canPinRoomEvents,
  getPinnedEventIds,
  setRoomEventPinned,
  subscribePendingPins,
  getPendingPinsVersion,
  getPendingPinnedEventIds,
} from './threadPinning';

export const usePinnedEventIds = (room: Room): string[] => {
  const events = useStateEvents(room, StateEvent.RoomPinnedEvents);
  const version = useSyncExternalStore(
    subscribePendingPins,
    getPendingPinsVersion,
    getPendingPinsVersion
  );
  return useMemo(() => {
    void version;
    return (
      getPendingPinnedEventIds(room) ??
      getPinnedEventIds(events.find((event) => event.getStateKey() === '')?.getContent())
    );
  }, [events, room, version]);
};

export const useThreadPinning = (room: Room) => {
  const mx = useMatrixClient();
  const powers = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const pinnedEventIds = usePinnedEventIds(room);
  const [state, updatePin] = useAsyncCallback(
    useCallback(
      (eventId: string, pinned: boolean) => setRoomEventPinned(mx, room, eventId, pinned),
      [mx, room]
    )
  );
  const setPinned = useCallback(
    (eventId: string, pinned: boolean) => {
      return updatePin(eventId, pinned).then(
        () => true,
        () => false
      );
    },
    [updatePin]
  );
  return {
    pinnedEventIds,
    canPin: canPinRoomEvents(creators, powers, mx.getSafeUserId()),
    setPinned,
    updating: state.status === AsyncStatus.Loading,
    error: state.status === AsyncStatus.Error ? state.error : undefined,
  };
};
