import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoom } from '../matrix/hooks/useRoom';
import { RoomCallButton } from './RoomCallButton';
import { useCallSupport } from './callSupport';
import {
  isActiveCallShownIn,
  useActiveCall,
  useCallPanel,
  useRoomCallMembers,
} from './callStore';
import { MenuEntry } from '../ui/MenuEntry';
import { AgentCallHeaderButton, useAgentCallCandidates } from './agent/AgentCallHeaderButton';
import { useAgentCaller } from './agent/agentCaller';

/** Whether a call is on in the room: someone is in it here, or this device shows it. */
const useLiveCall = () => {
  const mx = useMatrixClient();
  const room = useRoom();
  const shownHere = isActiveCallShownIn(useActiveCall(), room.roomId);
  const live = useRoomCallMembers(mx, room).length > 0 || shownHere;
  return { room, shownHere, live };
};

/**
 * What the header offers for calls. Nothing new where the deployment has no call service: calls
 * run only on its own (`chooseCallService`). Where a voice-capable agent is in the room, calling
 * it takes the place of the room's own call; call rooms and rooms without such an agent offer the
 * room's call. A call that is on is always shown, service or not. The agents are looked up once
 * per header: by the wide header, or on phones by the room menu while it is open.
 */
const useHeaderCalls = (threadId: string | undefined) => {
  const { room, shownHere, live } = useLiveCall();
  const offered = useCallSupport(useMatrixClient()) === 'supported';
  const candidates = useAgentCallCandidates(room, threadId);
  const offerAgent = offered && candidates.length > 0 && !room.isCallRoom() && !shownHere;
  const offerRoom = live || (offered && !offerAgent);
  return { room, candidates, offered, offerAgent, offerRoom, live };
};

type HeaderCallButtonsProps = {
  threadId?: string;
  /** A phone's header shows only a call that is on; the room menu offers the rest. */
  phone?: boolean;
};

/** A phone's header: only a call that is on; the room menu offers the rest. */
function PhoneHeaderCallButton() {
  const { room, live } = useLiveCall();
  return live ? <RoomCallButton room={room} /> : null;
}

function WideHeaderCallButtons({ threadId }: { threadId?: string }) {
  const { room, candidates, offerAgent, offerRoom } = useHeaderCalls(threadId);
  return (
    <>
      {offerRoom && <RoomCallButton room={room} />}
      {offerAgent && <AgentCallHeaderButton threadId={threadId} candidates={candidates} />}
    </>
  );
}

/** The room header's call buttons (see `useHeaderCalls`). */
export function HeaderCallButtons({ threadId, phone = false }: HeaderCallButtonsProps) {
  return phone ? <PhoneHeaderCallButton /> : <WideHeaderCallButtons threadId={threadId} />;
}

/**
 * The room menu's call entries on phones, for what `HeaderCallButtons` leaves out of a phone's
 * header: calling each voice-capable agent, or starting the room's call when none is on. None
 * where the deployment has no call service.
 */
export function HeaderCallMenuEntries({
  threadId,
  requestClose,
}: {
  threadId?: string;
  requestClose: () => void;
}) {
  const { t } = useTranslation();
  const { room, candidates, offered, offerAgent, live } = useHeaderCalls(threadId);
  const [, setPanelOpen] = useCallPanel(room.roomId);
  // The menu closes before the call starts, so the reason one did not start shows account-wide.
  const { call } = useAgentCaller({ announce: true });

  if (offerAgent) {
    return (
      <>
        {candidates.map((candidate) => (
          <MenuEntry
            key={candidate.userId}
            icon={Icons.Phone}
            label={t('mindroomUi.calls.agentCallHeaderButton.callAgent', {
              name: candidate.displayName,
            })}
            onSelect={() => {
              requestClose();
              void call({
                agentUserId: candidate.userId,
                displayName: candidate.displayName,
                roomId: room.roomId,
                threadId,
              });
            }}
          />
        ))}
      </>
    );
  }
  // A call that is on is the header button's; the menu starts one only where calls can run.
  if (live || !offered) return null;
  return (
    <MenuEntry
      icon={Icons.Phone}
      label={t('featureUi.calls.header.startCall')}
      onSelect={() => {
        requestClose();
        setPanelOpen(true);
      }}
    />
  );
}
