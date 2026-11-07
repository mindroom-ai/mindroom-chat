import { useMemo, useRef, useState } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import type { IconSrc } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader } from '../../ui/page/Page';
import {
  NavButton,
  NavCategory,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../ui/nav/NavItem';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { VirtualTile } from '../../ui/VirtualTile';
import { JoinAddressPrompt } from '../../rooms/join/JoinAddressPrompt';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
import { HOME_ROOM_LIST, useRoomOrder } from '../room-nav/roomOrder';
import { SortableRoomList, SortableRoomRow } from '../room-nav/SortableRoomList';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows, nestSubRooms, withSubRooms } from '../room-nav/SubRoomRows';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../routes/useHomeSelected';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useNavToActivePathMapper } from '../../routes/useNavToActivePathMapper';
import {
  makeNavScrollMemoryKey,
  useNavVirtualizer,
} from '../../ui/nav/navScrollMemory';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { ThreadNavCategory } from '../threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../threads/RecentlyOpenedNavCategory';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { commandPaletteOpenAtom } from '../../command-palette/commandPaletteState';
import { useRoomListShortcuts } from '../useRoomListShortcuts';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { getHomeCreatePath, getHomeRoomPath, withSearchParam } from '../../routes/pathUtils';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import { useHomeRooms } from '../../matrix/state/useHomeRooms';
import { HiddenRailPages } from './HiddenRailPages';

const ROOM_ROW_HEIGHT = 36;

type HomeHeaderProps = {
  roomIds: string[];
  /** Puts the hand-ordered Rooms back in A to Z order; only while they are ordered by hand. */
  onSortByName?: () => void;
};

function HomeHeader({ roomIds, onSortByName }: HomeHeaderProps) {
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
        <NavOptionsMenu label={t('featureUi.homeNav.options')} width={200}>
          {(close) => (
            <>
              <MenuGroup>
                <MarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />
                {onSortByName && (
                  <MenuEntry
                    label={t('featureUi.roomOrder.sortByName')}
                    icon={Icons.Sort}
                    onSelect={() => {
                      close();
                      onSortByName();
                    }}
                  />
                )}
              </MenuGroup>
              <HiddenRailPages onClose={close} />
            </>
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
  const openCommandPalette = useSetAtom(commandPaletteOpenAtom);
  const [joinOpen, setJoinOpen] = useState(false);

  const roomsCategoryId = makeNavCategoryId('home', 'room');
  const closedCategoriesAtom = useClosedNavCategoriesAtom();
  const [closedCategories, setClosedCategories] = useAtom(closedCategoriesAtom);
  const roomsClosed = closedCategories.has(roomsCategoryId);
  const isCategoryClosed = (categoryId: string) => closedCategories.has(categoryId);
  const handleCategoryClick = useCategoryHandler(setClosedCategories, isCategoryClosed);

  const roomToParents = useAtomValue(roomToParentsAtom);
  const roomsByName = useMemo(() => sortRoomIdsByName(client, homeRooms), [client, homeRooms]);
  // Sub-rooms show under their room, A to Z.
  const tree = useMemo(
    () => nestSubRooms(roomsByName, roomsByName, roomToParents),
    [roomsByName, roomToParents]
  );
  // A to Z until the person drags a room; then their order, on every device.
  const roomOrder = useRoomOrder(HOME_ROOM_LIST, tree.top);
  const shownRoomIds = useMemo(
    () => withSubRooms(roomOrder.roomIds, tree),
    [roomOrder.roomIds, tree]
  );
  const listedRoomIds = useMemo(
    () =>
      // A collapsed category still shows the selected room, on its own.
      roomsClosed ? shownRoomIds.filter((roomId) => roomId === selectedRoomId) : roomOrder.roomIds,
    [shownRoomIds, roomOrder.roomIds, roomsClosed, selectedRoomId]
  );
  const homeRoomPath = (roomId: string) =>
    getHomeRoomPath(getCanonicalAliasOrRoomId(client, roomId));
  useRoomListShortcuts(roomsClosed ? listedRoomIds : shownRoomIds, selectedRoomId, homeRoomPath);
  const renderSubRoom = (room: Room) => (
    <RoomNavItem
      room={room}
      linkPath={homeRoomPath(room.roomId)}
      selected={room.roomId === selectedRoomId}
      notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
    />
  );
  const previewPath = (roomId: string, viaServers: string[]) =>
    withSearchParam(getHomeRoomPath(roomId), { viaServers: viaServers.join(',') });

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
        label={t('sharedUi.joinAddressPrompt.joinARoom')}
        onSelect={() => setJoinOpen(true)}
      />
      <RoomAction
        action="search"
        icon={Icons.Search}
        label={t('nav.messageSearch')}
        selected={searchSelected}
        // Message search is the command palette's Messages tab; See all results opens the page.
        onSelect={() => openCommandPalette('messages')}
      />
    </NavCategory>
  );

  return (
    <PageNav label={t('nav.home')}>
      {joinOpen && (
        <JoinAddressPrompt onOpen={handleJoinOpen} onCancel={() => setJoinOpen(false)} />
      )}
      <PageNavContent
        scrollRef={listScrollRef}
        header={
          <HomeHeader
            roomIds={homeRooms}
            onSortByName={roomOrder.manual ? roomOrder.reset : undefined}
          />
        }
      >
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
              <SortableRoomList
                listId={HOME_ROOM_LIST}
                roomIds={listedRoomIds}
                onReorder={roomOrder.save}
              >
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
                        <SortableRoomRow
                          room={room}
                          linkPath={homeRoomPath(room.roomId)}
                          selected={roomId === selectedRoomId}
                          notificationMode={getRoomNotificationMode(
                            notificationPreferences,
                            room.roomId
                          )}
                        />
                        {!roomsClosed && (
                          <SubRoomRows
                            parent={room}
                            tree={tree}
                            renderRoom={renderSubRoom}
                            previewPath={previewPath}
                          />
                        )}
                      </VirtualTile>
                    );
                  })}
                </div>
              </SortableRoomList>
            </NavCategory>
            <ThreadNavCategory />
          </Box>
        )}
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
