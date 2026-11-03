import React, { useMemo } from 'react';
import { Box, Text } from 'folds';
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
import { getDirectRoomPath } from '../../pathUtils';

/** The Direct Messages navigation: joined direct rooms by latest activity. */









  const directRooms = useMemo(
    () =>
      rooms
        .filter((roomId) => directs.has(roomId))
        .map((roomId) => mx.getRoom(roomId))
        .filter((room): room is Room => !!room)
        .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp()),
    [mx, rooms, directs]
  );

  return (
    <PageNav>
      <PageNavHeader>
        <Box grow="Yes">
          <Text size="H4" truncate>
            {t('featureUi.sidebar.direct')}
          </Text>
        </Box>
      </PageNavHeader>
      <PageNavContent>
        <NavCategory>
          {directRooms.length === 0 && (
            <Text size="T300" priority="300" style={{ padding: '8px' }}>
              {t('featureUi.direct.empty')}
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
