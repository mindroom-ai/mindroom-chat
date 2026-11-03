import React, { useMemo, useState } from 'react';
import { Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Menu } from '../../../components/glass/GlassPrimitives';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { NavCategory } from '../../../components/nav';
import { RoomNavItem } from '../../../features/room-nav';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { mDirectAtom } from '../../../state/mDirectList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { stopPropagation } from '../../../utils/keyboard';
import { getDirectRoomPath } from '../../pathUtils';

/** The header's options button, whose menu marks every direct room read. */
function DirectOptionsMenu({ label, roomIds }: { label: string; roomIds: string[] }) {
  const [anchor, setAnchor] = useState<RectCords>();
  const closeMenu = () => setAnchor(undefined);

  return (
    <>
      <IconButton
        variant="Background"
        aria-label={label}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
          setAnchor(event.currentTarget.getBoundingClientRect())
        }
      >












              initialFocus: false,
              onDeactivate: closeMenu,
              returnFocusOnDeactivate: false,
            }}
          >
            <Menu style={{ width: '100vw', maxWidth: toRem(160) }}>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={closeMenu} />
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

const byLatestActivity = (a: Room, b: Room): number =>
  b.getLastActiveTimestamp() - a.getLastActiveTimestamp();

/** The Direct Messages navigation: joined direct rooms by latest activity. */



  // On a phone, opening the list keeps the remembered conversation for the next visit.
  useNavToActivePathMapper('direct', true);





  const directRooms = useMemo(() => {
    const joinedDirects: Room[] = [];
    rooms.forEach((roomId) => {
      const room = directs.has(roomId) ? mx.getRoom(roomId) : null;
      if (room) joinedDirects.push(room);
    });
    return joinedDirects.sort(byLatestActivity);
  }, [mx, rooms, directs]);

  return (
    <PageNav>
      <PageNavHeader>
        <Box gap="300" grow="Yes" alignItems="Center">
          <Box grow="Yes">
            <Text truncate size="H4">
              {t('nav.directMessages')}
            </Text>
          </Box>
          <DirectOptionsMenu
            label={t('featureUi.roomNav.roomNavItem.moreOptions')}
            roomIds={directRooms.map((room) => room.roomId)}
          />
        </Box>
      </PageNavHeader>
      <PageNavContent>
        <NavCategory>
          {directRooms.length === 0 && (
            <Text size="T300" priority="300" style={{ padding: '8px' }}>
              {t('nav.noDirectMessagesDescription')}
            </Text>
          )}
          {directRooms.map((room) => (
            <RoomNavItem
              key={room.roomId}
              room={room}
              selected={selectedRoomId === room.roomId}
              linkPath={getDirectRoomPath(getCanonicalAliasOrRoomId(mx, room.roomId))}
              notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
              direct
              showAvatar
            />
          ))}
        </NavCategory>
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
