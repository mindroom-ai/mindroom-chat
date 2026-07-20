import {
  ClientEvent,
  type ClientEventHandlerMap,
  type MatrixClient,
  type MatrixEvent,
  SyncState,
} from 'matrix-js-sdk';

import {
  isFlightRecorderActive,
  recordFlightRecorderMatrixSyncBatch,
  type MatrixSyncFlightRecorderRoom,
} from './flightRecorder';

type RoomBatch = {
  eventIds: Set<string>;
  anonymousEventCount: number;
  anonymousEditCount: number;
  editEventIds: Set<string>;
};

const installations = new WeakMap<MatrixClient, () => void>();

// FNV-1a gives this bounded diagnostic a stable room pseudonym without storing a Matrix ID.
export const hashFlightRecorderRoomId = (roomId: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < roomId.length; index += 1) {
    hash ^= roomId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const isEdit = (event: MatrixEvent): boolean => event.getRelation()?.rel_type === 'm.replace';

export const installMatrixSyncFlightRecorder = (mx: MatrixClient): (() => void) => {
  const existing = installations.get(mx);
  if (existing) return existing;
  if (!isFlightRecorderActive()) return () => undefined;

  const rooms = new Map<string, RoomBatch>();
  let disposed = false;

  const onEvent: ClientEventHandlerMap[ClientEvent.Event] = (event) => {
    const roomId = event.getRoomId();
    if (!roomId) return;
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        eventIds: new Set(),
        anonymousEventCount: 0,
        anonymousEditCount: 0,
        editEventIds: new Set(),
      };
      rooms.set(roomId, room);
    }
    const eventId = event.getId();
    if (eventId) {
      room.eventIds.add(eventId);
      if (isEdit(event)) room.editEventIds.add(eventId);
      return;
    }
    room.anonymousEventCount += 1;
    if (isEdit(event)) room.anonymousEditCount += 1;
  };

  let dispose = () => undefined;
  const onSync: ClientEventHandlerMap[ClientEvent.Sync] = (state, _previousState, data) => {
    if (state === SyncState.Stopped) {
      dispose();
      return;
    }
    if (state === SyncState.Prepared && data?.fromCache) {
      rooms.clear();
      return;
    }
    if (state !== SyncState.Syncing || rooms.size === 0) return;
    const batch: MatrixSyncFlightRecorderRoom[] = Array.from(rooms, ([roomId, room]) => ({
      roomHash: hashFlightRecorderRoomId(roomId),
      eventCount: room.eventIds.size + room.anonymousEventCount,
      editCount: room.editEventIds.size + room.anonymousEditCount,
    }));
    rooms.clear();
    recordFlightRecorderMatrixSyncBatch(batch);
  };

  dispose = () => {
    if (disposed) return;
    disposed = true;
    rooms.clear();
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.Sync, onSync);
    if (installations.get(mx) === dispose) installations.delete(mx);
  };
  installations.set(mx, dispose);
  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.Sync, onSync);
  return dispose;
};
