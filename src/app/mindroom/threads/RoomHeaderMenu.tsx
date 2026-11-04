import { forwardRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icons, Line, Spinner, toRem } from 'folds';
import { Menu } from '../../components/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../../components/MenuEntry';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  useRoomsNotificationPreferencesContext,
} from '../../hooks/useRoomsNotificationPreferences';
import { MindroomMarkRoomReadMenuItem } from '../notifications/MindroomMarkRoomReadMenuItem';
import { ArchiveRoomMenuItem } from '../rooms/ArchiveRoomMenuItem';

/** What the room header's options menu offers; an action left out hides its entry. */
export type RoomHeaderMenuActions = {
  onInvite?: () => void;
  onCopyLink: () => void;
  onOpenSettings: () => void;
  /** Absent in encrypted rooms, whose messages the server cannot search. */
  onSearchMessages?: () => void;
  /** Opens Jump to Time, which finds the room's event at a chosen date and time. */
  onJumpToTime?: () => void;
  /** Present only while the header has no Computer button of its own. */
  onShowComputer?: () => void;
  /** Entries for calls, on phones, whose header shows no call button while none is on. */
  calls?: ReactNode;
  onLeave: () => void;
};

type RoomHeaderMenuProps = RoomHeaderMenuActions & {
  room: Room;
  requestClose: () => void;
};

/** The room's notification mode, with its bell; it opens the mode menu beside the entry. */
function NotificationModeEntry({ room, onChosen }: { room: Room; onChosen: () => void }) {
  const { t } = useTranslation();
  const mode = getRoomNotificationMode(useRoomsNotificationPreferencesContext(), room.roomId);
  return (
    <RoomNotificationModeSwitcher roomId={room.roomId} value={mode} onChange={onChosen}>
      {(handleOpen, opened, changing) => (
        <MenuEntry
          label={t('mindroomUi.threads.mindroomRoomViewHeader.notifications')}
          icon={getRoomNotificationModeIcon(mode)}
          after={changing ? <Spinner size="100" variant="Secondary" /> : undefined}
          fill={opened ? 'Soft' : 'None'}
          aria-haspopup="menu"
          aria-expanded={opened}
          onSelect={handleOpen}
        />
      )}
    </RoomNotificationModeSwitcher>
  );
}

/**
 * The room header's options menu: read state, notification mode, sharing, settings, search, Jump
 * to Time, the computer and calls when the header does not show them, then archiving and leaving
 * the room.
 * The ref reaches the menu element, which the focus trap around it needs to close on Escape and
 * outside clicks.
 */
export const RoomHeaderMenu = forwardRef<HTMLDivElement, RoomHeaderMenuProps>(
  function RoomHeaderMenu(
    {
      room,
      requestClose,
      onInvite,
      onCopyLink,
      onOpenSettings,
      onSearchMessages,
      onJumpToTime,
      onShowComputer,
      calls,
      onLeave,
    },
    ref
  ) {
    const { t } = useTranslation();
    const closeThen = (action: () => void) => () => {
      requestClose();
      action();
    };

    return (
      <Menu ref={ref} style={{ minWidth: toRem(200), maxWidth: toRem(280) }}>
        <MenuGroup>
          <MindroomMarkRoomReadMenuItem room={room} onClose={requestClose} />
          <NotificationModeEntry room={room} onChosen={requestClose} />
          {onInvite && (
            <MenuEntry
              icon={Icons.UserPlus}
              label={t('mindroomUi.threads.mindroomRoomViewHeader.invite')}
              onSelect={closeThen(onInvite)}
            />
          )}
          <MenuEntry
            icon={Icons.Link}
            label={t('mindroomUi.threads.mindroomRoomViewHeader.copyLink')}
            onSelect={closeThen(onCopyLink)}
          />
          <MenuEntry
            icon={Icons.Setting}
            label={t('mindroomUi.threads.mindroomRoomViewHeader.roomSettings')}
            onSelect={closeThen(onOpenSettings)}
          />
          {onSearchMessages && (
            <MenuEntry
              icon={Icons.Search}
              label={t('nav.messageSearch')}
              onSelect={closeThen(onSearchMessages)}
            />
          )}
          {onJumpToTime && (
            <MenuEntry
              icon={Icons.RecentClock}
              label={t('featureUi.room.jumpToTime.jumpToTime')}
              onSelect={closeThen(onJumpToTime)}
            />
          )}
          {onShowComputer && (
            <MenuEntry
              icon={Icons.Monitor}
              label={t('mindroomUi.threads.mindroomRoomViewHeader.showComputer')}
              onSelect={closeThen(onShowComputer)}
            />
          )}
          {calls}
        </MenuGroup>
        <Line variant="Surface" size="300" />
        <MenuGroup>
          <ArchiveRoomMenuItem room={room} onClose={requestClose} />
          <MenuEntry
            critical
            directional
            icon={Icons.ArrowGoLeft}
            label={t('mindroomUi.threads.mindroomRoomViewHeader.leaveRoom')}
            onSelect={closeThen(onLeave)}
          />
        </MenuGroup>
      </Menu>
    );
  }
);
