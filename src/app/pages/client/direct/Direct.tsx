import React, { useMemo, useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Menu } from '../../../components/glass/GlassPrimitives';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { NavCategory, NavEmptyLayout } from '../../../components/nav';
import { RoomNavItem } from '../../../features/room-nav';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { mDirectAtom } from '../../../state/mDirectList';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { navigationRoomsAtom } from '../../../mindroom/rooms/archivedRooms';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { stopPropagation } from '../../../utils/keyboard';
import { getDirectCreatePath, getDirectRoomPath } from '../../pathUtils';

// Pressing Escape or clicking elsewhere closes a menu without moving focus around.
const LIGHT_DISMISS = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };

/** The header's options button, whose menu marks every direct room read. */
function DirectOptionsMenu({ label, roomIds }: { label: string; roomIds: string[] }) {
  const [anchor, setAnchor] = useState<RectCords>();
  const closeMenu = () => setAnchor(undefined);
  const openMenu = ({ currentTarget }: React.MouseEvent<HTMLButtonElement>) =>
    setAnchor(currentTarget.getBoundingClientRect());

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        ...LIGHT_DISMISS,
        initialFocus: false,
        returnFocusOnDeactivate: false,
        onDeactivate: closeMenu,
      }}
    >
      <Menu style={{ width: '100vw', maxWidth: toRem(160) }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={closeMenu} />
        </Box>
      </Menu>
    </FocusTrap>
  );

  return (
    <>
      <IconButton variant="Background" aria-label={label} onClick={openMenu}>
        <Icon size="200" src={Icons.VerticalDots} />
      </IconButton>
      <PopOut anchor={anchor} position="Bottom" align="End" offset={4} content={menu} />
    </>
  );
}

const byLatestActivity = (a: Room, b: Room): number =>
  b.getLastActiveTimestamp() - a.getLastActiveTimestamp();

/** The joined direct rooms the user has not archived, by latest activity. */
function useDirectRooms(): Room[] {
  const client = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directIds = useAtomValue(mDirectAtom);

  return useMemo(() => {
    const joinedDirects: Room[] = [];
    roomIds.forEach((roomId) => {
      const room = directIds.has(roomId) ? client.getRoom(roomId) : null;
      if (room) joinedDirects.push(room);
    });
    return joinedDirects.sort(byLatestActivity);
  }, [client, roomIds, directIds]);
}

/** The Direct Messages navigation: joined direct rooms by latest activity. */
export function Direct() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dmRooms = useDirectRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const activeRoomId = useSelectedRoom();
  // On a phone, opening the list keeps the remembered conversation for the next visit.
  useNavToActivePathMapper('direct', true);

  return (
    <PageNav label={t('nav.directMessages')}>
      <PageNavContent
        header={
          <PageNavHeader>
            <Box gap="300" grow="Yes" alignItems="Center">
              <Box grow="Yes">
                <Text as="h2" truncate size="H4">
                  {t('nav.directMessages')}
                </Text>
              </Box>
              <DirectOptionsMenu
                label={t('featureUi.directNav.options')}
                roomIds={dmRooms.map((room) => room.roomId)}
              />
            </Box>
          </PageNavHeader>
        }
      >
        {dmRooms.length === 0 ? (
          <NavEmptyLayout
            icon={<Icon size="600" src={Icons.Mention} />}
            title={
              <Text size="H5" align="Center">
                {t('nav.noDirectMessages')}
              </Text>
            }
            content={
              <Text size="T300" align="Center">
                {t('nav.noDirectMessagesDescription')}
              </Text>
            }
            options={
              <Button
                variant="Secondary"
                size="300"
                radii="300"
                onClick={() => navigate(getDirectCreatePath())}
              >
                <Text size="B300" truncate>
                  {t('nav.directMessage')}
                </Text>
              </Button>
            }
          />
        ) : (
          <NavCategory>
            {dmRooms.map((room) => (
              <RoomNavItem
                key={room.roomId}
                room={room}
                selected={activeRoomId === room.roomId}
                linkPath={getDirectRoomPath(getCanonicalAliasOrRoomId(client, room.roomId))}
                notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
                direct
                showAvatar
              />
            ))}
          </NavCategory>
        )}
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
