import { Box, Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageNav, PageNavContent, PageNavHeader } from '../../ui/page/Page';
import { NavCategory, NavEmptyLayout } from '../../ui/nav/NavItem';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import { useNavToActivePathMapper } from '../../routes/useNavToActivePathMapper';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { RecentlyOpenedNavCategory } from '../threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { MenuGroup } from '../../ui/MenuEntry';
import { getDirectCreatePath, getDirectRoomPath } from '../../routes/pathUtils';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import { useDirectRooms } from './useDirectRooms';
import { useRoomListShortcuts } from '../useRoomListShortcuts';

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
  useRoomListShortcuts(
    dmRooms.map((room) => room.roomId),
    activeRoomId,
    (roomId) => getDirectRoomPath(getCanonicalAliasOrRoomId(client, roomId))
  );

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
              <NavOptionsMenu label={t('featureUi.directNav.options')}>
                {(close) => (
                  <MenuGroup>
                    <MindroomMarkRoomsReadMenuItem
                      roomIds={dmRooms.map((room) => room.roomId)}
                      onClose={close}
                    />
                  </MenuGroup>
                )}
              </NavOptionsMenu>
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
