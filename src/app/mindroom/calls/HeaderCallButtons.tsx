import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { RoomCallButton } from '../../features/calls/RoomCallButton';
import {
  isActiveCallShownIn,
  useActiveCall,
  useCallPanel,
  useRoomCallMembers,
} from '../../features/calls/callStore';
import { HeaderMenuEntry } from '../threads/RoomHeaderMenu';
import { AgentCallHeaderButton, useAgentCallCandidates } from './AgentCallHeaderButton';
import { useAgentCaller } from './agentCaller';

/**
 * What the header offers for calls. Where a voice-capable agent is in the room, calling it takes
 * the place of the room's own call; call rooms and rooms without such an agent offer the room's
 * call. A call that is on (someone is in it here, or this device shows it) is always offered.
 */
const useHeaderCalls = (threadId: string | undefined) => {
  const mx = useMatrixClient();
  const room = useRoom();
  const candidates = useAgentCallCandidates(room, threadId);
  const shownHere = isActiveCallShownIn(useActiveCall(), room.roomId);
  const live = useRoomCallMembers(mx, room).length > 0 || shownHere;
  const offerAgent = candidates.length > 0 && !room.isCallRoom() && !shownHere;
  return { room, candidates, offerAgent, live };
};

type HeaderCallButtonsProps = {
  threadId?: string;
  /** A phone's header shows only a call that is on; the room menu offers the rest. */
  phone?: boolean;
};

/** The room header's call buttons (see `useHeaderCalls`). */
export function HeaderCallButtons({ threadId, phone = false }: HeaderCallButtonsProps) {
  const { room, candidates, offerAgent, live } = useHeaderCalls(threadId);
  if (phone) return live ? <RoomCallButton room={room} /> : null;
  return (
    <>
      {(!offerAgent || live) && <RoomCallButton room={room} />}
      {offerAgent && <AgentCallHeaderButton threadId={threadId} candidates={candidates} />}
    </>
  );
}

/**
 * The room menu's call entries on phones, for what `HeaderCallButtons` leaves out of a phone's
 * header: calling each voice-capable agent, or starting the room's call when none is on.
 */
export function HeaderCallMenuEntries({
  threadId,
  requestClose,
}: {
  threadId?: string;
  requestClose: () => void;
}) {
  const { t } = useTranslation();
  const { room, candidates, offerAgent, live } = useHeaderCalls(threadId);
  const [, setPanelOpen] = useCallPanel(room.roomId);
  const { call } = useAgentCaller();

  if (offerAgent) {
    return (
      <>
        {candidates.map((candidate) => (
          <HeaderMenuEntry
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
  if (live) return null;
  return (
    <HeaderMenuEntry
      icon={Icons.Phone}
      label={t('featureUi.calls.header.startCall')}
      onSelect={() => {
        requestClose();
        setPanelOpen(true);
      }}
    />
  );
}
