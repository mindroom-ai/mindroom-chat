import {
  EventType,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';

// A room's pins are one state event that every client writes whole, and a Matrix state write
// cannot say which version it replaces. When two people pin at the same moment, both read the
// list before either write lands, and the later write drops the earlier pin.
//
// Such a write has a shape. Compared with the list it replaced (the server's
// `unsigned.prev_content`, else the list this client had), it undoes pins and unpins made
// moments before and makes exactly one change of its own: the change its writer asked for, on
// top of an older list. This client then makes the undone change again, through the normal
// read-and-merge write: its own pin or unpin, and, when the stale write was its own, the other
// person's too. A write that only undoes a change is a deliberate unpin or pin by someone who saw
// it, and a write that makes several changes of its own is a deliberate bulk edit; both stand.

const PINS_EVENT: string = EventType.RoomPinnedEvents;
const WINDOW_MS = 30_000;
const MAX_REDOS = 3;

type Change = {
  pinned: boolean;
  at: number;
  /** A change this client asked for. */
  own: boolean;
  redos: number;
};

type Watch = {
  changes: Map<string, Change>;
  redo: (eventId: string, pinned: boolean) => Promise<void>;
  stop: () => void;
};

const watches = new WeakMap<Room, Watch>();

const pinsIn = (content: unknown): Set<string> => {
  const pinned = (content as { pinned?: unknown } | undefined)?.pinned;
  return new Set(
    Array.isArray(pinned) ? pinned.filter((id): id is string => typeof id === 'string') : []
  );
};

const handlePinEvent = (
  watch: Watch,
  userId: string,
  event: MatrixEvent,
  previous: MatrixEvent | null
) => {
  const now = Date.now();
  watch.changes.forEach((change, eventId) => {
    if (now - change.at > WINDOW_MS) watch.changes.delete(eventId);
  });
  const prevContent = event.getUnsigned().prev_content ?? previous?.getContent();
  if (prevContent) {
    const before = pinsIn(prevContent);
    const after = pinsIn(event.getContent());
    const made = new Map<string, boolean>();
    before.forEach((eventId) => {
      if (!after.has(eventId)) made.set(eventId, false);
    });
    after.forEach((eventId) => {
      if (!before.has(eventId)) made.set(eventId, true);
    });
    const undoes = (eventId: string, pinned: boolean) =>
      watch.changes.get(eventId)?.pinned === !pinned;
    const freshChanges = [...made].filter(([eventId, pinned]) => !undoes(eventId, pinned)).length;
    const stale = freshChanges === 1;
    const mine = event.getSender() === userId;
    made.forEach((pinned, eventId) => {
      const change = watch.changes.get(eventId);
      if (change?.own && change.pinned === pinned) return;
      if (change && stale && undoes(eventId, pinned) && (change.own || mine)) {
        if (change.redos < MAX_REDOS) {
          change.redos += 1;
          watch.redo(eventId, change.pinned).catch(() => undefined);
        }
        return;
      }
      watch.changes.set(eventId, { pinned, at: now, own: false, redos: 0 });
    });
  }
  if (![...watch.changes.values()].some((change) => change.own)) watch.stop();
};

/**
 * Watches the room's pins for half a minute after this client asks to pin or unpin `eventId`,
 * and makes a change again when a write from an older list undoes it. `redo` makes a change
 * through the client's read-and-merge write; asking again for the same change keeps its window
 * and its count of redos, so two clients cannot undo each other forever.
 */
export const guardPinWrite = (
  mx: MatrixClient,
  room: Room,
  eventId: string,
  pinned: boolean,
  redo: (eventId: string, pinned: boolean) => Promise<void>
) => {
  let watch = watches.get(room);
  if (!watch) {
    const userId = mx.getSafeUserId();
    const changes = new Map<string, Change>();
    const onState = (event: MatrixEvent, _state: unknown, previous: MatrixEvent | null) => {
      if (event.getType() !== PINS_EVENT || event.getStateKey() !== '') return;
      const current = watches.get(room);
      if (current) handlePinEvent(current, userId, event, previous);
    };
    room.on(RoomStateEvent.Events, onState);
    watch = {
      changes,
      redo,
      stop: () => {
        room.removeListener(RoomStateEvent.Events, onState);
        watches.delete(room);
      },
    };
    watches.set(room, watch);
  }
  watch.redo = redo;
  const change = watch.changes.get(eventId);
  if (change?.own && change.pinned === pinned && Date.now() - change.at <= WINDOW_MS) return;
  watch.changes.set(eventId, { pinned, at: Date.now(), own: true, redos: 0 });
};
