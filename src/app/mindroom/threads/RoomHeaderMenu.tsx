import React, { forwardRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Box, Icon, Icons, Line, Spinner, Text, config, toRem, type IconSrc } from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
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
  /** Present only while the header has no Computer button of its own. */
  onShowComputer?: () => void;
  onLeave: () => void;
};

type RoomHeaderMenuProps = RoomHeaderMenuActions & {
  room: Room;
  requestClose: () => void;
};

type EntryProps = {
  icon: IconSrc;
  label: string;
  onSelect: () => void;
  critical?: boolean;
};

const entryLabelStyle = { flexGrow: 1 } as const;

/** One menu row: the label, its icon at the end, and the menu closes before the action runs. */
function HeaderMenuEntry({ icon, label, onSelect, critical }: EntryProps) {
  return (
    <MenuItem
      size="300"
      radii="300"
      variant={critical ? 'Critical' : 'Surface'}
      after={<Icon size="100" src={icon} />}
      onClick={onSelect}
    >
      <Text as="span" size="T300" align="Left" truncate style={entryLabelStyle}>
        {label}
      </Text>
    </MenuItem>
  );
}

/** The room's notification mode, with its bell; it opens the mode menu beside the entry. */
function NotificationModeEntry({ room, onChosen }: { room: Room; onChosen: () => void }) {
  const { t } = useTranslation();
  const mode = getRoomNotificationMode(useRoomsNotificationPreferencesContext(), room.roomId);
  return (
    <RoomNotificationModeSwitcher roomId={room.roomId} value={mode} onChange={onChosen}>
      {(handleOpen, opened, changing) => (
        <MenuItem
          size="300"
          radii="300"
          variant="Surface"
          fill={opened ? 'Soft' : 'None'}
          aria-haspopup="menu"
          aria-expanded={opened}
          after={
            changing ? (
              <Spinner size="100" variant="Secondary" />
            ) : (
              <Icon size="100" src={getRoomNotificationModeIcon(mode)} />
            )
          }
          onClick={handleOpen}
        >
          <Text as="span" size="T300" align="Left" truncate style={entryLabelStyle}>
            {t('mindroomUi.threads.mindroomRoomViewHeader.notifications')}
          </Text>
        </MenuItem>
      )}
    </RoomNotificationModeSwitcher>
  );
}

function MenuGroup({ children }: { children: ReactNode }) {
  return (
    <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
      {children}
    </Box>
  );
}

/**
 * The room header's options menu: read state, notification mode, sharing, settings, search, the
 * computer when the header does not show it, then archiving and leaving the room. The ref
 * reaches the menu element, which the focus trap around it needs to close on Escape and outside
 * clicks.
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
      onShowComputer,
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
            <HeaderMenuEntry
              icon={Icons.UserPlus}
              label={t('mindroomUi.threads.mindroomRoomViewHeader.invite')}
              onSelect={closeThen(onInvite)}
            />
          )}
          <HeaderMenuEntry
            icon={Icons.Link}
            label={t('mindroomUi.threads.mindroomRoomViewHeader.copyLink')}
            onSelect={closeThen(onCopyLink)}
          />
          <HeaderMenuEntry
            icon={Icons.Setting}
            label={t('mindroomUi.threads.mindroomRoomViewHeader.roomSettings')}
            onSelect={closeThen(onOpenSettings)}
          />
          {onSearchMessages && (
            <HeaderMenuEntry
              icon={Icons.Search}
              label={t('nav.messageSearch')}
              onSelect={closeThen(onSearchMessages)}
            />
          )}
          {onShowComputer && (
            <HeaderMenuEntry
              icon={Icons.Monitor}
              label={t('mindroomUi.threads.mindroomRoomViewHeader.showComputer')}
              onSelect={closeThen(onShowComputer)}
            />
          )}
        </MenuGroup>
        <Line variant="Surface" size="300" />
        <MenuGroup>
          <ArchiveRoomMenuItem room={room} onClose={requestClose} />
          <HeaderMenuEntry
            critical
            icon={Icons.ArrowGoLeft}
            label={t('mindroomUi.threads.mindroomRoomViewHeader.leaveRoom')}
            onSelect={closeThen(onLeave)}
          />
        </MenuGroup>
      </Menu>
    );
  }
);
