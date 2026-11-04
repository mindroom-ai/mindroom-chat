import { useMemo, useRef, useState } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import type { IconSrc } from 'folds';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
  NavLink,
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
  makeNavScrollMemoryKey,
  useNavVirtualizer,
} from '../../../mindroom/sidebar/navScrollMemory';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useVisibleRooms } from '../../../mindroom/rooms/archivedRooms';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { MenuGroup } from '../../../components/MenuEntry';
import {
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { NavOptionsMenu } from '../NavOptionsMenu';
import { sortRoomIdsByName } from '../../../utils/nameOrder';
import { useHomeRooms } from './useHomeRooms';

const ROOM_ROW_HEIGHT = 36;

function HomeHeader({ roomIds }: { roomIds: string[] }) {
  const { t } = useTranslation();
  const title = t('nav.home');

  return (
    <PageNavHeader>
      <Box gap="300" grow="Yes" alignItems="Center">
        <Box grow="Yes">
          <Text as="h2" truncate size="H4">
            {title}
          </Text>
        </Box>
        {/* Its own name, so it is not taken for a room's More Options button. */}
        <NavOptionsMenu label={t('featureUi.homeNav.options')}>
          {(close) => (
            <MenuGroup>
              <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />
            </MenuGroup>
          )}
        </NavOptionsMenu>
      </Box>
    </PageNavHeader>
  );
}

type RoomActionProps = {
  /** Value of `data-home-room-action`, which tests and styles select on. */
  action: 'create' | 'join' | 'search';
  icon: IconSrc;
  label: string;
  selected?: boolean;
} & ({ onSelect: () => void; to?: undefined } | { to: string; onSelect?: undefined });

/** One of the shortcuts above the room list: a link when it opens a page, else a button. */
function RoomAction({ action, icon, label, selected, onSelect, to }: RoomActionProps) {
  const content = (
    <NavItemContent>
      <Box as="span" alignItems="Center" gap="200" grow="Yes">
        <Avatar radii="400" size="200">
          <Icon size="100" src={icon} />
        </Avatar>
        <Text as="span" size="Inherit" truncate>
          {label}
        </Text>
      </Box>
    </NavItemContent>
  );
  return (
    <NavItem aria-selected={selected} radii="400" variant="Background">
      {to === undefined ? (
        <NavButton data-home-room-action={action} onClick={onSelect}>
          {content}
        </NavButton>
      ) : (
        <NavLink data-home-room-action={action} to={to}>
          {content}
        </NavLink>
      )}
    </NavItem>
  );
}

/** The Home navigation: room actions, the rooms outside spaces, threads, and recently opened. */
export function Home() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listScrollRef = useRef<HTMLDivElement>(null);
  // On a phone, opening the list keeps the remembered room for the next visit.
  useNavToActivePathMapper('home', true);
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
  const isCategoryClosed = (categoryId: string) => closedCategories.has(categoryId);
  const handleCategoryClick = useCategoryHandler(setClosedCategories, isCategoryClosed);

  const listedRoomIds = useMemo(() => {
    const items = sortRoomIdsByName(client, homeRooms);
    if (!roomsClosed) return items;
    // A collapsed category still shows the selected room.
    return items.filter((roomId) => roomId === selectedRoomId);
  }, [client, homeRooms, roomsClosed, selectedRoomId]);

  // The list reopens where it was left: after a space, or a room or thread that took a phone's
  // whole screen.
  const virtualizer = useNavVirtualizer(makeNavScrollMemoryKey(client.getSafeUserId(), 'home'), {
    getScrollElement: () => listScrollRef.current,
    count: listedRoomIds.length,
    estimateSize: () => ROOM_ROW_HEIGHT,
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
      <RoomAction
        action="create"
        icon={Icons.Plus}
        label={t('nav.createRoom')}
        selected={createSelected}
        onSelect={() => navigate(getHomeCreatePath())}
      />
      <RoomAction
        action="join"
        icon={Icons.Link}
        label={t('nav.joinWithAddress')}
        onSelect={() => setJoinOpen(true)}
      />
      <RoomAction
        action="search"
        icon={Icons.Search}
        label={t('nav.messageSearch')}
        selected={searchSelected}
        to={getHomeSearchPath()}
      />
    </NavCategory>
  );

  return (
    <PageNav label={t('nav.home')}>
      {joinOpen && (
        <JoinAddressPrompt onOpen={handleJoinOpen} onCancel={() => setJoinOpen(false)} />
      )}
      <PageNavContent scrollRef={listScrollRef} header={<HomeHeader roomIds={homeRooms} />}>
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
          <Box direction="Column" gap="300">
            {roomActions}
            <NavCategory data-testid="room-nav-category">
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
                  const roomId = listedRoomIds[item.index];
                  const room = client.getRoom(roomId);
                  if (!room) return null;
                  return (
                    <VirtualTile
                      // By room, so a row's open prompt stays with its room when the list shifts.
                      key={roomId}
                      virtualItem={item}
                      ref={virtualizer.measureElement}
                    >
                      <RoomNavItem
                        room={room}
                        linkPath={getHomeRoomPath(getCanonicalAliasOrRoomId(client, room.roomId))}
                        selected={roomId === selectedRoomId}
                        notificationMode={getRoomNotificationMode(
                          notificationPreferences,
                          room.roomId
                        )}
                      />
                    </VirtualTile>
                  );
                })}
              </div>
            </NavCategory>
            <ThreadNavCategory />
          </Box>
        )}
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
