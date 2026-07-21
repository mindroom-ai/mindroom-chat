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
  let disposed = false;

  const onEvent: ClientEventHandlerMap[ClientEvent.Event] = (event) => {
    const roomId = event.getRoomId();
    if (!roomId) return;
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        eventIds: new Set(),
        anonymousEvents: new Set(),
        anonymousEditEvents: new Set(),
        anonymousEncryptedEvents: new Set(),
        editEventIds: new Set(),
        encryptedEventIds: new Set(),
      };
      rooms.set(roomId, room);
    }
    const eventId = event.getId();
    if (eventId) {
      room.eventIds.add(eventId);
      if (isEdit(event)) {
        room.encryptedEventIds.delete(eventId);
        room.editEventIds.add(eventId);
      } else if (isUnresolvedEncrypted(event)) room.encryptedEventIds.add(eventId);
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
      return;
    }
    if (state !== SyncState.Syncing || rooms.size === 0) return;
    const batch: MatrixSyncFlightRecorderRoom[] = Array.from(rooms, ([roomId, room]) => ({
      roomHash: hashFlightRecorderRoomId(roomId),
      eventCount: room.eventIds.size + room.anonymousEvents.size,
      editCount: room.editEventIds.size + room.anonymousEditEvents.size,
      encryptedCount: room.encryptedEventIds.size + room.anonymousEncryptedEvents.size,
    }));
    rooms.clear();
    recordFlightRecorderMatrixSyncBatch(batch);
  };

  dispose = () => {
    if (disposed) return;
    disposed = true;
    rooms.clear();
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
