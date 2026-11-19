import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PopOut } from '../../ui/directional';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  useCloseUserRoomProfile,
  useUserRoomProfileState,
} from '../../navigation/useUserRoomProfileState';
import { stopPropagation } from '../../lib/keyboard';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { BottomSheet } from '../../ui/BottomSheet';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { UserRoomProfile } from './UserRoomProfile';

// Escape (which goes no further than the card) and clicks outside end the trap and the card.
const ENDS_ON = { escapeDeactivates: stopPropagation, clickOutsideDeactivates: true };

/**
 * The member profile card that is open (`userRoomProfileAtom`), floating beside what opened
 * it; an agent's card slides up as a sheet on a phone. A click outside the card or Escape
 * closes it.
 */
export function UserRoomProfileRenderer() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const profile = useUserRoomProfileState();
  const close = useCloseUserRoomProfile();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const room = mx.getRoom(profile?.roomId);
  if (!profile || !room) return null;

  if (phone && isMindroomAgentUserIdForViewer(profile.userId, mx.getUserId() ?? undefined)) {
    return (
      <BottomSheet
        title={t('sharedUi.agentCard.agent')}
        closeLabel={t('sharedUi.agentCard.close')}
        requestClose={close}
        fitContent
      >
        <UserRoomProfile
          key={`${profile.roomId}:${profile.userId}`}
          room={room}
          userId={profile.userId}
          onDone={close}
        />
      </BottomSheet>
    );
  }

  return (
    <PopOut
      anchor={profile.cords}
      position={profile.position ?? 'Bottom'}
      align="Start"
      offset={8}
      content={
        <FocusTrap focusTrapOptions={{ ...ENDS_ON, initialFocus: false, onDeactivate: close }}>
          <Menu role="dialog" aria-label={profile.userId}>
            <UserRoomProfile
              key={`${profile.roomId}:${profile.userId}`}
              room={room}
              userId={profile.userId}
              onDone={close}
            />
          </Menu>
        </FocusTrap>
      }
    />
  );
}
