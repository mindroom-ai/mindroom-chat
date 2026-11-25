import {
  type ComponentProps,
  type MouseEventHandler,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import type { IconSrc } from 'folds';
import type { Room } from 'matrix-js-sdk';
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
import { HOME_ROOM_LIST, type RoomOrder } from '../room-nav/roomOrder';
import { getRoomActivityTimestamp } from '../room-nav/roomActivity';
import { RoomSortMenu } from '../room-nav/RoomSortMenu';
import {
  SortableRoomGroup,
  SortableRoomList,
  SortableRoomRow,
  useRoomSectionDrop,
} from '../room-nav/SortableRoomList';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows, type SubRoomTree } from '../room-nav/SubRoomRows';
import { useRoomListShortcuts } from '../useRoomListShortcuts';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import { useHomeCreateSelected } from '../../routes/useHomeSelected';
import { useNavToActivePathMapper } from '../../routes/useNavToActivePathMapper';
import { makeNavScrollMemoryKey, useNavVirtualizer } from '../../ui/nav/navScrollMemory';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { ThreadNavCategory } from '../threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../threads/RecentlyOpenedNavCategory';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { CommandPaletteSearchField } from '../../command-palette/CommandPaletteSearchField';
import * as searchFieldCss from '../../command-palette/CommandPaletteSearchField.css';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { MenuGroup } from '../../ui/MenuEntry';
import { PairedTouchTarget } from '../../ui/styles/TouchTarget.css';
import { getHomeCreatePath, getHomeRoomPath, withSearchParam } from '../../routes/pathUtils';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import { SpaceRoomSection } from '../space/SpaceRoomSection';
import { HiddenRailPages } from './HiddenRailPages';
import { MacAppMenuEntry } from './MacAppMenuEntry';
import { useHomeRoomSections } from './useHomeRoomSections';

const ROOM_ROW_HEIGHT = 36;

type HomeHeaderProps = {
  roomIds: string[];
  sort?: Pick<RoomOrder, 'mode' | 'showTimes' | 'hasSavedOrder' | 'setMode' | 'setShowTimes'>;
};

function HomeHeader({ roomIds, sort }: HomeHeaderProps) {
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
        <Box alignItems="Center" gap="100" shrink="No">
          {sort && (
            <RoomSortMenu
              mode={sort.mode}
              showTimes={sort.showTimes}
              hasSavedOrder={sort.hasSavedOrder}
              onModeChange={sort.setMode}
              onShowTimesChange={sort.setShowTimes}
              buttonClassName={PairedTouchTarget}
            />
          )}
          {/* Its own name, so it is not taken for a room's More Options button. */}
          <NavOptionsMenu
            label={t('featureUi.homeNav.options')}
            width={200}
            buttonClassName={PairedTouchTarget}
          >
            {(close) => (
              <>
                <MenuGroup>
                  <MarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />
                </MenuGroup>
                <HiddenRailPages onClose={close} />
                <MacAppMenuEntry onClose={close} />
              </>
            )}
          </NavOptionsMenu>
        </Box>
      </Box>
    </PageNavHeader>
  );
}

type RoomActionProps = {
  /** Value of `data-home-room-action`, which tests and styles select on. */
  action: 'create' | 'join';
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

type HomeUnspacedRoomsSectionProps = {
  roomsCategoryId: string;
  roomsClosed: boolean;
  listedRoomIds: string[];
  tree: SubRoomTree;
  roomOrder: Pick<RoomOrder, 'mode' | 'save'>;
  virtualizer: ReturnType<typeof useNavVirtualizer<HTMLDivElement, Element>>;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  rowProps: (room: Room) => ComponentProps<typeof SortableRoomRow>;
  renderSubRoom: (room: Room) => ReactNode;
};

/** Home's unspaced Rooms section, registered as a droppable boundary inside Home's SortableRoomGroup. */
function HomeUnspacedRoomsSection({
  roomsCategoryId,
  roomsClosed,
  listedRoomIds,
  tree,
  roomOrder,
  virtualizer,
  onCategoryClick,
  rowProps,
  renderSubRoom,
}: HomeUnspacedRoomsSectionProps) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const sectionDrop = useRoomSectionDrop(HOME_ROOM_LIST);

  return (
    <NavCategory data-testid="room-nav-category" {...sectionDrop}>
      <NavCategoryHeader>
        <RoomNavCategoryButton
          closed={roomsClosed}
          data-category-id={roomsCategoryId}
          onClick={onCategoryClick}
        >
          {t('nav.rooms')}
        </RoomNavCategoryButton>
      </NavCategoryHeader>
      <SortableRoomList
        listId={HOME_ROOM_LIST}
        roomIds={listedRoomIds}
        onReorder={roomOrder.save}
        reorderDisabled={roomOrder.mode === 'recent'}
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
                <SortableRoomRow {...rowProps(room)} />
                {!roomsClosed && (
                  <SubRoomRows
                    parent={room}
                    tree={tree}
                    renderRoom={renderSubRoom}
                    previewPath={getHomeRoomPath}
                  />
                )}
              </VirtualTile>
            );
          })}
        </div>
      </SortableRoomList>
    </NavCategory>
  );
}

/** The Home navigation: room actions, unspaced rooms, space sections, threads, and recently opened. */
export function Home() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listScrollRef = useRef<HTMLDivElement>(null);
  // On a phone, opening the list keeps the remembered room for the next visit.
  useNavToActivePathMapper('home', true);
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();
  const createSelected = useHomeCreateSelected();
  // A phone's top bar holds the same field.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const [joinOpen, setJoinOpen] = useState(false);

  const {
    allVisibleHomeRooms,
    unspaced,
    roomsCategoryId,
    roomsClosed,
    tree,
    listedRoomIds,
    roomOrder,
    sections,
    shortcutRoomIds,
    onCategoryClick,
    onReorder,
  } = useHomeRoomSections(selectedRoomId);
  const homeRoomPath = (roomId: string) =>
    getHomeRoomPath(getCanonicalAliasOrRoomId(client, roomId));
  useRoomListShortcuts(shortcutRoomIds, selectedRoomId, homeRoomPath);
  // A room's row, the same at top level and under the room it sits under, except that there it
  // frames its hash.
  const rowProps = (room: Room) => ({
    room,
    linkPath: homeRoomPath(room.roomId),
    selected: room.roomId === selectedRoomId,
    notificationMode: getRoomNotificationMode(notificationPreferences, room.roomId),
    activityTimestamp: roomOrder.showTimes
      ? getRoomActivityTimestamp(room) || undefined
      : undefined,
  });
  const renderSubRoom = (room: Room) => <RoomNavItem {...rowProps(room)} subRoom />;

  // The list reopens where it was left: after a space, or a room or thread that took a phone's
  // whole screen.
  const virtualizer = useNavVirtualizer(makeNavScrollMemoryKey(client.getSafeUserId(), 'home'), {
    getScrollElement: () => listScrollRef.current,
    count: listedRoomIds.length,
    // A room's tile grows with the sub-rooms under it, so its height goes with the room.
    getItemKey: (index) => listedRoomIds[index] ?? index,
    estimateSize: () => ROOM_ROW_HEIGHT,
    overscan: 10,
  });

  const handleJoinOpen = (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => {
    setJoinOpen(false);
    void navigate(
      withSearchParam(getHomeRoomPath(roomIdOrAlias, eventId), {
        viaServers: viaServers && viaServers.length > 0 ? viaServers.join(',') : undefined,
      })
    );
  };

  const roomActions = (
    <NavCategory>
      {!phone && <CommandPaletteSearchField className={searchFieldCss.NavSearchField} />}
      <RoomAction
        action="create"
        icon={Icons.Plus}
        label={t('nav.createRoom')}
        selected={createSelected}
        onSelect={() => void navigate(getHomeCreatePath())}
      />
      <RoomAction
        action="join"
        icon={Icons.Link}
        label={t('sharedUi.joinAddressPrompt.joinARoom')}
        onSelect={() => setJoinOpen(true)}
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
            roomIds={allVisibleHomeRooms}
            sort={unspaced.length > 0 ? roomOrder : undefined}
          />
        }
      >
        {unspaced.length === 0 && sections.length === 0 ? (
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
            <SortableRoomGroup>
              {unspaced.length > 0 && (
                <HomeUnspacedRoomsSection
                  roomsCategoryId={roomsCategoryId}
                  roomsClosed={roomsClosed}
                  listedRoomIds={listedRoomIds}
                  tree={tree}
                  roomOrder={roomOrder}
                  virtualizer={virtualizer}
                  onCategoryClick={onCategoryClick}
                  rowProps={rowProps}
                  renderSubRoom={renderSubRoom}
                />
              )}
              {sections.map((section) => (
                <SpaceRoomSection
                  key={section.categoryId}
                  section={section}
                  spaceId={section.spaceId}
                  spaceIdOrAlias={section.spaceId}
                  selectedRoomId={selectedRoomId}
                  onCategoryClick={onCategoryClick}
                  onReorder={onReorder}
                  roomPath={getHomeRoomPath}
                  showOverview
                  pinMode={section.ancestorSpaceIds.length > 0 ? 'toggle' : undefined}
                />
              ))}
            </SortableRoomGroup>
            <ThreadNavCategory />
          </Box>
        )}
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
