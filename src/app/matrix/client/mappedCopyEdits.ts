import type { IEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { isEventOrderedAfter } from '../room';

// The SDK's event mapper reuses the event the client holds when it maps a copy of it, and makes the
// copy's bundled edit the event's replacement, also when that edit is older than the one the event
// shows. The SDK maps such copies on its own: a thread's root bundles its latest reply with the
// reply's edit as the server or a thread list had it, and the SDK maps that reply again whenever it
// reads the root (from the saved sync, the server or a thread list). A streamed reply then went
// back from the cache's 101 words to 81 while its thread opened after a reload, until the next
// edit arrived. This module keeps the newer edit an event shows when a copy brings an older one.

type RawEvent = Partial<IEvent>;

/** The edit shown by the event the client holds for `raw`, when `raw` bundles an edit of it. */
const shownEditOfHeldEvent = (
  mx: MatrixClient,
  raw: RawEvent
): { held: MatrixEvent; edit: MatrixEvent } | undefined => {
  if (!raw.unsigned?.['m.relations']?.['m.replace'] || !raw.room_id || !raw.event_id) return;
  if (raw.state_key !== undefined) return;
  const held = mx.getRoom(raw.room_id)?.findEventById(raw.event_id);
  const edit = held && !held.status ? held.replacingEvent() : null;
  return held && edit ? { held, edit } : undefined;
};

/** Makes the client's event mappers keep an event's newer edit over a copy's older one; call it once. */
export const keepNewerEditsOnMappedCopies = (mx: MatrixClient): void => {
  const getEventMapper = mx.getEventMapper.bind(mx);
  mx.getEventMapper = (options) => {
    const map = getEventMapper(options);
    return (raw) => {
      const shown = shownEditOfHeldEvent(mx, raw);
      const event = map(raw);
      const applied = event.replacingEvent();
      if (
        shown &&
        event === shown.held &&
        applied &&
        applied !== shown.edit &&
        !shown.edit.isRedacted() &&
        isEventOrderedAfter(shown.edit, applied)
      ) {
        event.makeReplaced(shown.edit);
      }
      return event;
    };
  };
};
