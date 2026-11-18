import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useAlive } from '../../../lib/hooks/useAlive';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../../../matrix/hooks/useStateEvent';
import { ROOM_SETTINGS_EVENT, readRoomSettingValue } from '../../../matrix/protocol/roomSettings';

// How long a tile reads Saved after a write went through.
const SAVED_FOR_MS = 2000;

type Saved = { value: string; eventId: string; older: ReadonlySet<string | undefined> };

/**
 * One `io.mindroom.room_settings` setting as a tile shows and writes it: `value` is the room's
 * value as `read` takes it from the event's content, `''` while unset, or the tile's own latest
 * save until the room shows something newer. `write` resolves true once the room took the value,
 * while the tile is still shown.
 */
export function useRoomSetting(
  room: Room,
  key: string,
  read: (content: unknown) => string | undefined = readRoomSettingValue
) {
  const client = useMatrixClient();
  const alive = useAlive();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canEdit = may.stateEvent(ROOM_SETTINGS_EVENT, client.getSafeUserId());
  const event = useStateEvent(room, ROOM_SETTINGS_EVENT, key);
  const eventId = event?.getId();
  const live = read(event?.getContent()) ?? '';
  // The latest save's value and event, and the events older than it: those the room showed when
  // this tile's saves went out, and the saves' own. While the room shows one of those, the save
  // counts; its own echo or anyone else's event ends that.
  const [saved, setSaved] = useState<Saved>();
  const value = saved && eventId !== saved.eventId && saved.older.has(eventId) ? saved.value : live;
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Saved shows for a moment after a write, until the person changes something again. Each write
  // sets a new object, so a second one within the moment restarts the timer even in the same render.
  const [justSaved, setJustSaved] = useState<object>();
  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(undefined), SAVED_FOR_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const write = (next: string): Promise<boolean> => {
    const before = eventId;
    setSending(true);
    setFailed(false);
    setJustSaved(undefined);
    const content = next === '' ? {} : { value: next };
    return client
      .sendStateEvent(room.roomId, ROOM_SETTINGS_EVENT as never, content as never, key)
      .then(
        ({ event_id: sentId }) => {
          if (!alive()) return false;
          setSaved((last) => ({
            value: next,
            eventId: sentId,
            older: new Set([...(last?.older ?? []), last?.eventId, before]),
          }));
          setSending(false);
          setJustSaved({});
          return true;
        },
        () => {
          if (!alive()) return false;
          setFailed(true);
          setSending(false);
          return false;
        }
      );
  };

  const clearFeedback = () => {
    setFailed(false);
    setJustSaved(undefined);
  };

  return {
    canEdit,
    value,
    sending,
    failed,
    justSaved: justSaved !== undefined,
    write,
    clearFeedback,
  };
}
