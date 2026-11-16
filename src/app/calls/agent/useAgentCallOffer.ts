import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { useCallSupport } from '../callSupport';
import { isActiveCallShownIn, useActiveCall } from '../callStore';
import {
  getAgentCallCandidates,
  keepThreadSenders,
  type AgentCallCandidate,
} from './agentCallCandidates';
import { usePresenceStatuses } from './agentPresence';

const NONE: AgentCallCandidate[] = [];

/** The room's voice-capable agents; in a thread, the ones that took part in it when any did. */
export const useAgentCallCandidates = (
  room: Room,
  threadId: string | undefined
): AgentCallCandidate[] => {
  const mx = useMatrixClient();
  const viewer = mx.getUserId() ?? undefined;
  const members = useRoomMembers(mx, room.roomId);
  const agentIds = useMemo(
    () =>
      members
        .filter((member) => isMindroomAgentUserIdForViewer(member.userId, viewer))
        .map((member) => member.userId),
    [members, viewer]
  );
  const statuses = usePresenceStatuses(mx, agentIds);
  return useMemo(() => {
    const candidates = getAgentCallCandidates(members, viewer, (userId) => statuses.get(userId));
    if (!threadId) return candidates;
    const inThread = keepThreadSenders(candidates, room, threadId);
    return inThread.length > 0 ? inThread : candidates;
  }, [members, viewer, statuses, room, threadId]);
};

/**
 * The agents to offer a call to in `room`, about `threadId` when given: its voice-capable agents
 * (`useAgentCallCandidates`), and none unless the deployment has a call service, the room is not
 * a call room (whose call is in the room itself) and no call shows in the room already. The room
 * header's call button and the command palette both offer what this gives.
 */
export const useAgentCallOffer = (
  room: Room,
  threadId: string | undefined
): AgentCallCandidate[] => {
  const supported = useCallSupport(useMatrixClient()) === 'supported';
  const shownHere = isActiveCallShownIn(useActiveCall(), room.roomId);
  const candidates = useAgentCallCandidates(room, threadId);
  return supported && !room.isCallRoom() && !shownHere ? candidates : NONE;
};
