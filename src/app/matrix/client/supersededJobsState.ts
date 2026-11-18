import { RoomStateEvent, type MatrixClient } from 'matrix-js-sdk';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../protocol/backgroundJobsContract';

// Each agent publishes its background jobs as one state event per room, the whole list on every
// change, and each write carries the list it replaces as well (`unsigned.prev_content`). A room
// with 50 streaming agents got more than one such write a second, and its timelines kept them all:
// about a megabyte a minute that nothing reads, since every reader takes the jobs from the room's
// current state.

/**
 * Empties an agent's jobs state (its list, and the copy of the list before it) once a newer one
 * replaces it in the room's current state, whose own event stays whole. The client announces only
 * a room's current state, so a page of history or of a timeline before a sync gap, which changes
 * the state of an older time, empties nothing.
 */
export const emptySupersededJobsState = (mx: MatrixClient): void => {
  mx.on(RoomStateEvent.Events, (event, state, previous) => {
    if (event.getType() !== MINDROOM_BACKGROUND_JOBS_EVENT) return;
    const previousId = previous?.getId();
    if (!previousId || previousId === event.getId()) return;
    // The timeline's event with that ID, which is the replaced state itself unless the server sends
    // the state apart from the timeline (`state_after`). It is the agent's write before this
    // one, so the search from the newest end passes every event the room took since: few while
    // the agent streams, all of a quiet agent's silence on its next write.
    const superseded = mx
      .getRoom(state.roomId)
      ?.getUnfilteredTimelineSet()
      .getTimelineForEvent(previousId)
      ?.getEvents()
      .findLast((held) => held.getId() === previousId);
    if (!superseded) return;
    // Emptied with no event announced and nothing drawn again: the jobs are read from the current
    // state alone (`agentRoomState`), which no longer holds this event, and nothing reads the list
    // before a jobs state. What tells the event's place stays (ID, time, type, state key): a read
    // receipt may name the event, and the timeline rows count their places over every event, so
    // it is not removed. The event gets a new object and the one it was made from stays as the
    // server sent it: the sync store holds that one as the room's state until it takes this
    // batch, and a save in between would keep it. The event cache saves its own copies.
    const { prev_content: _listBefore, ...unsigned } = superseded.event.unsigned ?? {};
    superseded.event = { ...superseded.event, content: {}, unsigned };
  });
};
