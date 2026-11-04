import FocusTrap from 'focus-trap-react';
import { PopOut } from '../directional';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  useCloseUserRoomProfile,
  useUserRoomProfileState,
} from '../../state/hooks/userRoomProfile';
import { stopPropagation } from '../../utils/keyboard';
import { Menu } from '../glass/GlassPrimitives';
import { UserRoomProfile } from './UserRoomProfile';

// Escape (which goes no further than the card) and clicks outside end the trap and the card.
const ENDS_ON = { escapeDeactivates: stopPropagation, clickOutsideDeactivates: true };

/**
 * The member profile card that is open (`userRoomProfileAtom`), floating beside what opened
 * it. A click outside the card or Escape closes it.
 */
export function UserRoomProfileRenderer() {
  const profile = useUserRoomProfileState();
  const close = useCloseUserRoomProfile();
  const room = useMatrixClient().getRoom(profile?.roomId);
  if (!profile || !room) return null;

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
