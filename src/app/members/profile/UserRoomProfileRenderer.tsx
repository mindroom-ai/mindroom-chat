import { useCallback, useEffect, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import type { RectCords } from 'folds';
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

// A DOMRect keeps its sides on its prototype, so a spread would copy none of them.
const copy = ({ x, y, width, height }: RectCords): RectCords => ({ x, y, width, height });

/**
 * The card's anchor, again as a new object whenever the card changes size (its tools arrive, More
 * opens), so the pop-out places it inside the window once more: it places itself only for a new
 * anchor or a resized window.
 */
const useAnchorFollowingSize = (cords: RectCords | undefined) => {
  const [anchor, setAnchor] = useState(cords);
  useEffect(() => setAnchor(cords), [cords]);
  const observer = useRef<ResizeObserver>();
  const observe = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => setAnchor((current) => current && copy(current)));
    observer.current.observe(node);
  }, []);
  return [anchor, observe] as const;
};

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
  const [anchor, observeCard] = useAnchorFollowingSize(profile?.cords);
  const room = mx.getRoom(profile?.roomId);
  if (!profile || !room) return null;

  if (phone && isMindroomAgentUserIdForViewer(profile.userId, mx.getUserId() ?? undefined)) {
    return (
      <BottomSheet
        title={profile.userId}
        closeLabel={t('sharedUi.agentCard.close')}
        requestClose={close}
        fitContent
        titleHidden
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
      anchor={anchor}
      position={profile.position ?? 'Bottom'}
      align="Start"
      offset={8}
      content={
        <FocusTrap focusTrapOptions={{ ...ENDS_ON, initialFocus: false, onDeactivate: close }}>
          <Menu role="dialog" aria-label={profile.userId}>
            <div ref={observeCard}>
              <UserRoomProfile
                key={`${profile.roomId}:${profile.userId}`}
                room={room}
                userId={profile.userId}
                onDone={close}
              />
            </div>
          </Menu>
        </FocusTrap>
      }
    />
  );
}
