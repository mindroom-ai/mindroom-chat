import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { RoomEvent, RoomStateEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../matrix/types/room';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { getStateEvent } from '../../matrix/room';
import {
  canPinRoomEvents,
  getPinnedEventIds,
  setRoomEventPinned,
  subscribePendingPins,
  getPendingPinsVersion,
  getPendingPinnedEventIds,
} from './threadPinning';
import { matchesEnum } from '../../lib/matchesEnum';

export const usePinnedEventIds = (room: Room): string[] => {
  const [stateVersion, refresh] = useForceUpdate();
  useEffect(() => {
    const handleState = (event: MatrixEvent) => {
      if (matchesEnum(event.getType(), StateEvent.RoomPinnedEvents) && event.getStateKey() === '')
        refresh();
    };
    room.on(RoomStateEvent.Events, handleState);
    room.on(RoomEvent.CurrentStateUpdated, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, handleState);
      room.removeListener(RoomEvent.CurrentStateUpdated, refresh);
    };
  }, [room, refresh]);
  const version = useSyncExternalStore(
    subscribePendingPins,
    getPendingPinsVersion,
    getPendingPinsVersion
  );
  return useMemo(() => {
    void version;
    void stateVersion;
    return (
      getPendingPinnedEventIds(room) ??
      getPinnedEventIds(getStateEvent(room, StateEvent.RoomPinnedEvents)?.getContent())
    );
  }, [room, version, stateVersion]);
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
