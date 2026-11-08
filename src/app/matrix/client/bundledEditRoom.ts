import type { IEvent, MatrixClient } from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';
import { stripRedactedRelationsFromRawEvent } from '../eventRevision';

// A server bundles an event's newest edit in `unsigned['m.relations']['m.replace']`, formatted as
// the response formats its events, so the bundle of a /sync timeline event has no room ID either.
// The SDK's event mapper re-inserts the room ID of a thread's bundled latest reply, but not of a
// bundled edit: it makes the bundle the event's replacement and decrypts it as it is, and its
// Rust crypto takes an encrypted event without a room ID for a to-device message ("to-device event
// was not decrypted in preprocessToDeviceMessages") and never tries it again. The message then
// showed nothing on that device until an unbundled copy of the edit came by. This module gives
// every bundled edit the room ID of the event it belongs to before the mapper reads it, and leaves
// out every bundled edit whose redaction the room took (eventRevision.ts).

type RawEvent = Partial<IEvent>;

const withBundledEditRoom = (raw: RawEvent): RawEvent => {
  const relations = raw.unsigned?.['m.relations'];
  const bundled: unknown = relations?.['m.replace'];
  if (!raw.room_id || !isRecord(bundled) || bundled.room_id !== undefined) return raw;
  return {
    ...raw,
    unsigned: {
      ...raw.unsigned,
      'm.relations': { ...relations, 'm.replace': { ...bundled, room_id: raw.room_id } },
    },
  };
};

/**
 * Makes the client's event mappers give bundled edits their event's room ID, and leave out those
 * the room took a redaction of; call it once.
 */
export const keepBundledEditsInTheirRoom = (mx: MatrixClient): void => {
  const getEventMapper = mx.getEventMapper.bind(mx);
  mx.getEventMapper = (options) => {
    const map = getEventMapper(options);
    return (raw) => {
      // A copy from elsewhere, such as the cache, keeps no edit whose redaction the room took, also
      // with an event its thread summary bundles (eventRevision.ts).
      const redacted = mx.getRoom(raw.room_id)?.redactedBundledEdits;
      return map(
        withBundledEditRoom(redacted ? stripRedactedRelationsFromRawEvent(raw, redacted) : raw)
      );
    };
  };
};
