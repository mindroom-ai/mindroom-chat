import { Box, Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { MenuGroup } from '../../../components/MenuEntry';
import { getDirectCreatePath, getDirectRoomPath } from '../../pathUtils';
import { NavOptionsMenu } from '../NavOptionsMenu';
import { useDirectRooms } from './useDirectRooms';

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
