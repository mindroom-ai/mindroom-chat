import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { MINDROOM_SERVER_EVENT } from '../computer/agentServer';
import { useAgentRoomState } from '../matrix/protocol/agentRoomState';

/** Each agent's role from its server state, by user ID; an agent that publishes none has no entry. */
const selectAgentRoles = (events: MatrixEvent[]): Map<string, string> =>
  new Map(
    events.flatMap((event): Array<[string, string]> => {
      const { role } = event.getContent();
      const text = typeof role === 'string' ? role.trim() : '';
      return text ? [[event.getSender()!, text]] : [];
    })
  );

/**
 * What the room's agents say they do: the `role` each publishes about itself in its
 * `io.mindroom.server` state, which only that agent can write (`agentRoomState`).
 */
export const useAgentRoles = (room: Room | null): Map<string, string> =>
  useAgentRoomState(room, MINDROOM_SERVER_EVENT, selectAgentRoles);
