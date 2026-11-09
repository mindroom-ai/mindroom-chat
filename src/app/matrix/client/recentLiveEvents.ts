import {
  EventType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { isUnreadableYet } from '../decryptionWaits';

/** How long the recorder keeps an event: the longest a call's ring may last. */
export const RECENT_LIVE_EVENTS_MS = 120_000;

const recordings = new WeakMap<MatrixClient, () => MatrixEvent[]>();

/**
 * Starts keeping what sync announces live that may be a call's ring or its decline: those events,
 * and encrypted ones not readable yet, from the last {@link RECENT_LIVE_EVENTS_MS}. The ring
 * watcher starts with the signed-in pages, which load on their own while the client starts;
 * started before the first sync, this keeps what that sync delivers until the watcher takes it
 * with {@link takeRecentLiveEvents}. The saved sync a client starts from is not live, so a ring
 * the last page showed is not kept again.
 */
export const recordRecentLiveEvents = (mx: MatrixClient): void => {
  let kept: MatrixEvent[] = [];
  const recent = () => {
    const since = Date.now() - RECENT_LIVE_EVENTS_MS;
    return kept.filter((event) => event.getTs() > since);
  };
  const onTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (event, _room, older, gone, at) => {
    if (older || gone || at?.liveEvent !== true) return;
    const type = event.getType();
    if (
      matchesEnum(type, EventType.RTCNotification) ||
      matchesEnum(type, EventType.RTCDecline) ||
      isUnreadableYet(event)
    ) {
      kept = [...recent(), event];
    }
  };
  mx.on(RoomEvent.Timeline, onTimeline);
  recordings.set(mx, () => {
    mx.off(RoomEvent.Timeline, onTimeline);
    recordings.delete(mx);
    return recent();
  });
};

/**
 * Stops the recording of `mx` and gives what it kept, in the order sync delivered it; nothing
 * for a client that records nothing, or the second time.
 */
export const takeRecentLiveEvents = (mx: MatrixClient): MatrixEvent[] =>
  recordings.get(mx)?.() ?? [];
