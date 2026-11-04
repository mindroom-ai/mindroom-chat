import React from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { RoomCallButton } from '../../features/calls/RoomCallButton';
import {
  isActiveCallShownIn,
  useActiveCall,
  useRoomCallMembers,
} from '../../features/calls/callStore';
import { AgentCallHeaderButton, useAgentCallCandidates } from './AgentCallHeaderButton';

/**
 * The room header's call buttons. Where a voice-capable agent is in the room, its call button
 * takes the place of the room's own call, which comes back once someone is in a call here (to
 * join it) or this device is (to show it); call rooms and rooms without such an agent always
 * offer the room's call.
 */
export function HeaderCallButtons({ threadId }: { threadId?: string }) {
  const mx = useMatrixClient();
  const room = useRoom();
  const candidates = useAgentCallCandidates(room, threadId);
  const active = useActiveCall();
  const ongoing = useRoomCallMembers(mx, room).length > 0;
  const shownHere = isActiveCallShownIn(active, room.roomId);
  const offerAgent = candidates.length > 0 && !room.isCallRoom() && !shownHere;
  return (
    <>
      {(!offerAgent || ongoing || shownHere) && <RoomCallButton room={room} />}
      {offerAgent && <AgentCallHeaderButton threadId={threadId} candidates={candidates} />}
    </>
  );
}
