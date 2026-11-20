import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { PopOut } from '../../ui/directional';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  useCloseUserRoomProfile,
  useUserRoomProfileState,
} from '../../navigation/useUserRoomProfileState';
import type { UserRoomProfileState } from '../../navigation/userRoomProfile';
import { stopPropagation } from '../../lib/keyboard';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { BottomSheet } from '../../ui/BottomSheet';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { ProfileCard, useProfileName } from './UserRoomProfile';

// Escape (which goes no further than the card) and clicks outside end the trap and the card.
const ENDS_ON = { escapeDeactivates: stopPropagation, clickOutsideDeactivates: true };

/**
 * The card beside what opened it, or an agent's as a sheet on a phone, titled with its name. An
 * agent's card is named by the name it shows; a person's, whose ID shows under the name, by the ID.
 */
function OpenProfile({
  open,
  room,
  close,
}: {
  open: UserRoomProfileState;
  room: Room;
  close: () => void;
}) {
  const { t } = useTranslation();
  const me = useMatrixClient().getUserId() ?? undefined;
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const read = useProfileName(room, open.userId);
  const { name } = read;
  const agent = open.userId !== me && isMindroomAgentUserIdForViewer(open.userId, me);
  const card = (titled: boolean) => (
    <ProfileCard room={room} userId={open.userId} onDone={close} titled={titled} {...read} />
  );

  if (phone && agent) {
    return (
      <BottomSheet
        title={name}
        closeLabel={t('sharedUi.agentCard.close')}
        requestClose={close}
        fitContent
      >
        {card(true)}
      </BottomSheet>
    );
  }
  return (
    <PopOut
      anchor={open.cords}
      position={open.position ?? 'Bottom'}
      align="Start"
      offset={8}
      content={
        <FocusTrap focusTrapOptions={{ ...ENDS_ON, initialFocus: false, onDeactivate: close }}>
          <Menu role="dialog" aria-label={agent ? name : open.userId}>
            {card(false)}
          </Menu>
        </FocusTrap>
      }
    />
  );
}

/** The member profile card that is open (`userRoomProfileAtom`). */
export function UserRoomProfileRenderer() {
  const profile = useUserRoomProfileState();
  const close = useCloseUserRoomProfile();
  const room = useMatrixClient().getRoom(profile?.roomId);
  if (!profile || !room) return null;
  return (
    <OpenProfile
      key={`${profile.roomId}:${profile.userId}`}
      open={profile}
      room={room}
      close={close}
    />
  );
}
