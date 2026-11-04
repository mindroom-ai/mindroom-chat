import { ClientEvent, ThreadEvent, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk';

export type RoomThreadWatcher = {
  /**
   * A thread the SDK announced, or updated after a batch it added (also one that only read the
   * summary again), and each thread a room already holds when its watch starts.
   */
  onThread: (room: Room, thread: Thread) => void;
  /**
   * More listeners on one room, set up after its thread listeners and before its threads are
   * passed to `onThread`; returns what removes them.
   */
  onRoom?: (room: Room) => () => void;
};

/**
 * Follows the threads of every room the client holds, and of each room it learns of later, for
 * the client's whole life; start it before the client, so it sees the saved sync. A room the
 * account forgets leaves the store, and its listeners go with it, so the room can be freed.
 * Returns what stops the watch.
 */
export const watchRoomThreads = (
  mx: MatrixClient,
  { onThread, onRoom }: RoomThreadWatcher
): (() => void) => {
  const stops = new Map<Room, () => void>();

  const watchRoom = (room: Room) => {
    if (stops.has(room)) return;
    const onRoomThread = (thread: Thread) => onThread(room, thread);
    room.on(ThreadEvent.New, onRoomThread);
    room.on(ThreadEvent.Update, onRoomThread);
    const stopRoom = onRoom?.(room);
    stops.set(room, () => {
      room.removeListener(ThreadEvent.New, onRoomThread);
      room.removeListener(ThreadEvent.Update, onRoomThread);
      stopRoom?.();
    });
    // The saved sync announces a room after its threads are in.
    room.getThreads().forEach(onRoomThread);
  };

  const forgetRoom = (deletedRoomId: string) => {
    stops.forEach((stop, room) => {
      if (room.roomId !== deletedRoomId) return;
      stop();
      stops.delete(room);
    });
  };

  mx.on(ClientEvent.Room, watchRoom);
  mx.on(ClientEvent.DeleteRoom, forgetRoom);
  mx.getRooms().forEach(watchRoom);

  return () => {
    mx.removeListener(ClientEvent.Room, watchRoom);
    mx.removeListener(ClientEvent.DeleteRoom, forgetRoom);
    stops.forEach((stop) => stop());
    stops.clear();
  };
};
