import { useContext } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoom } from '../matrix/hooks/useRoom';
import { RoomCallButton } from './RoomCallButton';
import { useCallSupport } from './callSupport';
import { isActiveCallShownIn, useActiveCall, useRoomCallMembers } from './callStore';
import { AgentCallHeaderButton } from './agent/AgentCallHeaderButton';
import { useAgentCallOffer } from './agent/useAgentCallOffer';
import { PhoneThreadCallPlace } from './headerCallPlace';

/**
 * What the header offers for calls. Nothing new where the deployment has no call service: calls
 * run only on its own (`chooseCallService`). Where a voice-capable agent is in the room, calling
 * it takes the place of the room's own call; call rooms and rooms without such an agent offer the
 * room's call. A call that is on is always shown, service or not. Phones show the same buttons
 * as wide screens, but for a thread that fills a phone's page (`PhoneThreadCallPlace`). Which
 * agents are offered is `useAgentCallOffer`'s rule, which the command palette follows too.
 */
const useHeaderCalls = (threadId: string | undefined) => {
  const mx = useMatrixClient();
  const room = useRoom();
  // A call is on in the room: someone is in it here, or this device shows it.
  const shownHere = isActiveCallShownIn(useActiveCall(), room.roomId);
  const live = useRoomCallMembers(mx, room).length > 0 || shownHere;
  const offered = useCallSupport(mx) === 'supported';
  const candidates = useAgentCallOffer(room, threadId);
  const offerAgent = candidates.length > 0;
  const offerRoom = live || (offered && !offerAgent);
  return { room, candidates, offerAgent, offerRoom };
};

/** The room header's call buttons (see `useHeaderCalls`). */
export function HeaderCallButtons({ threadId }: { threadId?: string }) {
  const { room, candidates, offerAgent, offerRoom } = useHeaderCalls(threadId);
  const place = useContext(PhoneThreadCallPlace);
  const agents = (
    <AgentCallHeaderButton threadId={threadId} candidates={candidates} inMenu={place?.closeMenu} />
  );
  if (place?.closeMenu) return offerRoom && offerAgent ? agents : null;
  return (
    <>
      {offerRoom && <RoomCallButton room={room} />}
      {offerAgent && !(place && offerRoom) && agents}
    </>
  );
}
