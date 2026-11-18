import { RoomStateEvent, type MatrixClient, type RoomStateEventHandlerMap } from 'matrix-js-sdk';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../protocol/backgroundJobsContract';

// Each agent publishes its background jobs as one state event per room, the whole list on every
// change, and each write carries the list it replaces as well (`unsigned.prev_content`). A room
// with 50 streaming agents got more than one such write a second, and its timelines kept them all:
// about a megabyte a minute that nothing reads, since every reader takes the jobs from the room's
// current state. The event itself stays in the timelines: a read receipt may name it, and the
// timeline rows count their places over every event.

/**
 * Empties an agent's jobs state (its list, and the copy of the list before it) once a newer one
 * replaces it in the room's current state, whose own event stays whole. The client announces only
 * a room's current state, so a page of history, which changes the state of an older time, empties
 * nothing. Returns what stops it.
 */
export const emptySupersededJobsState = (mx: MatrixClient): (() => void) => {
  const onStateEvent: RoomStateEventHandlerMap[RoomStateEvent.Events] = (
    event,
    _state,
    previous
  ) => {
    if (event.getType() !== MINDROOM_BACKGROUND_JOBS_EVENT) return;
    if (!previous || previous === event || previous.getId() === event.getId()) return;
    previous.event.content = {};
    delete previous.event.unsigned?.prev_content;
  };
  mx.on(RoomStateEvent.Events, onStateEvent);
  return () => {
    mx.off(RoomStateEvent.Events, onStateEvent);
  };
};
