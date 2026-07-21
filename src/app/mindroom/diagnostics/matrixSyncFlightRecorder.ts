import {
  ClientEvent,
  type ClientEventHandlerMap,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  SyncState,
} from 'matrix-js-sdk';

import {
  isFlightRecorderActive,
  recordFlightRecorderMatrixSyncBatch,
  type MatrixSyncFlightRecorderOverflow,
  type MatrixSyncFlightRecorderRoom,
} from './flightRecorder';

type RoomBatch = {
  eventIds: Set<string>;
  anonymousEvents: Set<MatrixEvent>;
  anonymousEditEvents: Set<MatrixEvent>;
  anonymousEncryptedEvents: Set<MatrixEvent>;
  editEventIds: Set<string>;
  encryptedEventIds: Set<string>;
};

export const MATRIX_SYNC_MAX_PENDING_ROOMS = 8;
export const MATRIX_SYNC_MAX_PENDING_EVENTS_PER_ROOM = 32;

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

const isEdit = (event: MatrixEvent): boolean => {
  const decryptedRelation = event.getOriginalContent()['m.relates_to'] as
    | Record<string, unknown>
    | undefined;
  return (event.getRelation() ?? decryptedRelation)?.rel_type === 'm.replace';
};
const isUnresolvedEncrypted = (event: MatrixEvent): boolean =>
  event.isEncrypted() && (event.getClearContent() === null || event.isDecryptionFailure());

export const installMatrixSyncFlightRecorder = (mx: MatrixClient): (() => void) => {
  const existing = installations.get(mx);
  if (existing) return existing;
  if (!isFlightRecorderActive()) return () => undefined;

  const rooms = new Map<string, RoomBatch>();
  const overflow: MatrixSyncFlightRecorderOverflow = {
    eventCount: 0,
    editCount: 0,
    encryptedCount: 0,
  };
  let disposed = false;

  const resetOverflow = () => {
    overflow.eventCount = 0;
    overflow.editCount = 0;
    overflow.encryptedCount = 0;
  };
  const addOverflowEvent = (event: MatrixEvent) => {
    overflow.eventCount += 1;
    if (isEdit(event)) overflow.editCount += 1;
    else if (isUnresolvedEncrypted(event)) overflow.encryptedCount += 1;
  };
  const roomCounts = (room: RoomBatch): MatrixSyncFlightRecorderOverflow => ({
    eventCount: room.eventIds.size + room.anonymousEvents.size,
    editCount: room.editEventIds.size + room.anonymousEditEvents.size,
    encryptedCount: room.encryptedEventIds.size + room.anonymousEncryptedEvents.size,
  });
  const foldRoomIntoOverflow = (room: RoomBatch) => {
    const counts = roomCounts(room);
    overflow.eventCount += counts.eventCount;
    overflow.editCount += counts.editCount;
    overflow.encryptedCount += counts.encryptedCount;
  };
  const roomHasPriorityEvidence = (room: RoomBatch) => {
    const counts = roomCounts(room);
    return counts.editCount > 0 || counts.encryptedCount > 0;
  };

  const makeRoomBatch = (): RoomBatch => ({
    eventIds: new Set(),
    anonymousEvents: new Set(),
    anonymousEditEvents: new Set(),
    anonymousEncryptedEvents: new Set(),
    editEventIds: new Set(),
    encryptedEventIds: new Set(),
  });

  const onEvent: ClientEventHandlerMap[ClientEvent.Event] = (event) => {
    const roomId = event.getRoomId();
    if (!roomId) return;
    let room = rooms.get(roomId);
    if (!room) {
      if (rooms.size >= MATRIX_SYNC_MAX_PENDING_ROOMS) {
        if (!isEdit(event) && !isUnresolvedEncrypted(event)) {
          addOverflowEvent(event);
          return;
        }
        const eviction = Array.from(rooms).find(([, batch]) => !roomHasPriorityEvidence(batch));
        if (!eviction) {
          addOverflowEvent(event);
          return;
        }
        const [evictedRoomId, evictedRoom] = eviction;
        rooms.delete(evictedRoomId);
        foldRoomIntoOverflow(evictedRoom);
      }
      room = makeRoomBatch();
      rooms.set(roomId, room);
    }
    const eventId = event.getId();
    if (eventId) {
      if (
        !room.eventIds.has(eventId) &&
        room.eventIds.size + room.anonymousEvents.size >= MATRIX_SYNC_MAX_PENDING_EVENTS_PER_ROOM
      ) {
        addOverflowEvent(event);
        return;
      }
      room.eventIds.add(eventId);
      if (isEdit(event)) {
        room.encryptedEventIds.delete(eventId);
        room.editEventIds.add(eventId);
      } else if (isUnresolvedEncrypted(event)) room.encryptedEventIds.add(eventId);
      return;
    }
    if (
      !room.anonymousEvents.has(event) &&
      room.eventIds.size + room.anonymousEvents.size >= MATRIX_SYNC_MAX_PENDING_EVENTS_PER_ROOM
    ) {
      addOverflowEvent(event);
      return;
    }
    room.anonymousEvents.add(event);
    if (isEdit(event)) {
      room.anonymousEncryptedEvents.delete(event);
      room.anonymousEditEvents.add(event);
    } else if (isUnresolvedEncrypted(event)) room.anonymousEncryptedEvents.add(event);
  };

  const onDecrypted = (event: MatrixEvent) => {
    const roomId = event.getRoomId();
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (isUnresolvedEncrypted(event)) return;
    const eventId = event.getId();
    if (eventId) {
      if (!room.eventIds.has(eventId)) return;
      room.encryptedEventIds.delete(eventId);
      if (isEdit(event)) room.editEventIds.add(eventId);
      return;
    }
    if (!room.anonymousEvents.has(event)) return;
    room.anonymousEncryptedEvents.delete(event);
    if (isEdit(event)) room.anonymousEditEvents.add(event);
  };

  let dispose = () => undefined;
  const onSync: ClientEventHandlerMap[ClientEvent.Sync] = (state, _previousState, data) => {
    if (state === SyncState.Stopped) {
      dispose();
      return;
    }
    if (state === SyncState.Prepared && data?.fromCache) {
      rooms.clear();
      resetOverflow();
      return;
    }
    if (state !== SyncState.Syncing || (rooms.size === 0 && overflow.eventCount === 0)) return;
    const batch: MatrixSyncFlightRecorderRoom[] = Array.from(rooms, ([roomId, room]) => ({
      roomHash: hashFlightRecorderRoomId(roomId),
      ...roomCounts(room),
    }));
    rooms.clear();
    const overflowEvidence = overflow.eventCount > 0 ? { ...overflow } : undefined;
    resetOverflow();
    recordFlightRecorderMatrixSyncBatch(batch, overflowEvidence);
  };

  dispose = () => {
    if (disposed) return;
    disposed = true;
    rooms.clear();
    resetOverflow();
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    mx.removeListener(ClientEvent.Sync, onSync);
    if (installations.get(mx) === dispose) installations.delete(mx);
  };
  installations.set(mx, dispose);
  mx.on(ClientEvent.Event, onEvent);
  mx.on(MatrixEventEvent.Decrypted, onDecrypted);
  mx.on(ClientEvent.Sync, onSync);
  return dispose;
};
