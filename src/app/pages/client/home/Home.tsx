import React, { MouseEventHandler, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import { Menu } from '../../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { MatrixClient } from 'matrix-js-sdk';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
} from '../../../components/nav';
import { VirtualTile } from '../../../components/virtualizer';
import { JoinAddressPrompt } from '../../../components/join-address-prompt';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../../hooks/router/useHomeSelected';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { stopPropagation } from '../../../utils/keyboard';
import { useVisibleRooms } from '../../../mindroom/rooms/archivedRooms';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import {
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { useHomeRooms } from './useHomeRooms';

const ROOM_ROW_HEIGHT = 38;

const lastActivity = (mx: MatrixClient, roomId: string): number =>
  mx.getRoom(roomId)?.getLastActiveTimestamp?.() ?? 0;

/** Rooms by latest activity. */
const sortRooms = (mx: MatrixClient, roomIds: string[]): string[] =>
  [...roomIds].sort((a, b) => lastActivity(mx, b) - lastActivity(mx, a));

function HomeHeader({ roomIds }: { roomIds: string[] }) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (event) =>
    setMenuAnchor(event.currentTarget.getBoundingClientRect());

  return (
    <PageNavHeader>
      <Box alignItems="Center" grow="Yes" gap="300">
        <Box grow="Yes">
          <Text size="H4" truncate>
            {t('nav.home')}
          </Text>
        </Box>
        <IconButton



















              }}
            >


                  <MindroomMarkRoomsReadMenuItem
                    roomIds={roomIds}
                    onClose={() => setMenuAnchor(undefined)}
                  />
                </Box>
              </Menu>
            </FocusTrap>
          }
        />
      </Box>
    </PageNavHeader>
  );
}

/** The Home navigation: room actions, the rooms outside spaces, threads, and recently opened. */






  const homeRooms = useVisibleRooms(useHomeRooms());
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();
  const createSelected = useHomeCreateSelected();
  const searchSelected = useHomeSearchSelected();
  const [joinOpen, setJoinOpen] = useState(false);

  const roomsCategoryId = makeNavCategoryId('home', 'room');
  const closedCategoriesAtom = useClosedNavCategoriesAtom();
  const [closedCategories, setClosedCategories] = useAtom(closedCategoriesAtom);
  const roomsClosed = closedCategories.has(roomsCategoryId);





    const items = sortRooms(mx, homeRooms);
    if (!roomsClosed) return items;
    // A collapsed category still shows the selected room.
    return items.filter((roomId) => roomId === selectedRoomId);






    overscan: 10,
  });

  const handleJoinOpen = (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => {
    setJoinOpen(false);
    navigate(
      withSearchParam(getHomeRoomPath(roomIdOrAlias, eventId), {
        viaServers: viaServers && viaServers.length > 0 ? viaServers.join(',') : undefined,
      })
    );
  };

  const roomActions = (
    <NavCategory>
      <NavItem variant="Background" radii="400" aria-selected={createSelected}>
        <NavButton data-home-room-action="create" onClick={() => navigate(getHomeCreatePath())}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                <Icon src={Icons.Plus} size="100" />
              </Avatar>
              <Text as="span" size="Inherit" truncate>
                {t('nav.createRoom')}
              </Text>
            </Box>
          </NavItemContent>
        </NavButton>
      </NavItem>
      <NavItem variant="Background" radii="400">
        <NavButton data-home-room-action="join" onClick={() => setJoinOpen(true)}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                <Icon src={Icons.Link} size="100" />
              </Avatar>
              <Text as="span" size="Inherit" truncate>
                {t('nav.joinWithAddress')}
              </Text>
            </Box>
          </NavItemContent>
        </NavButton>
      </NavItem>
      <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
        <NavButton data-home-room-action="search" onClick={() => navigate(getHomeSearchPath())}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                <Icon src={Icons.Search} size="100" />
              </Avatar>
              <Text as="span" size="Inherit" truncate>
                {t('nav.messageSearch')}
              </Text>
            </Box>
          </NavItemContent>
        </NavButton>
      </NavItem>
    </NavCategory>
  );

  return (
    <PageNav>
      <HomeHeader roomIds={homeRooms} />
      {joinOpen && (
        <JoinAddressPrompt onOpen={handleJoinOpen} onCancel={() => setJoinOpen(false)} />
      )}
      {homeRooms.length === 0 ? (
        <NavEmptyLayout
          icon={<Icon size="600" src={Icons.Hash} />}
          title={
            <Text size="H5" align="Center">
              {t('nav.noRooms')}
            </Text>
          }
          content={
            <Text size="T300" align="Center">
              {t('nav.noRoomsDescription')}
            </Text>
          }
          options={roomActions}
        />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            {roomActions}
            <NavCategory>
              <NavCategoryHeader>
                <RoomNavCategoryButton
                  closed={roomsClosed}
                  data-category-id={roomsCategoryId}
                  onClick={handleCategoryClick}
                >
                  {t('nav.rooms')}
                </RoomNavCategoryButton>
              </NavCategoryHeader>
              <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const roomId = sortedRooms[item.index];
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  return (
                    <VirtualTile
                      key={item.index}
                      virtualItem={item}







                      />
                    </VirtualTile>
                  );
                })}
              </div>
            </NavCategory>
            <ThreadNavCategory />
          </Box>
        </PageNavContent>
      )}
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
