import {
  type ComponentProps,
  type MouseEventHandler,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { PageNav, PageNavContent } from '../../ui/page/Page';
import { NavCategory, NavEmptyLayout } from '../../ui/nav/NavItem';
import { VirtualTile } from '../../ui/VirtualTile';
import { JoinAddressPrompt } from '../../rooms/join/JoinAddressPrompt';
import { HOME_ROOM_LIST, type RoomOrder } from '../room-nav/roomOrder';
import { getRoomActivityTimestamp } from '../room-nav/roomActivity';
import {
  SortableRoomGroup,
  SortableRoomList,
  SortableRoomRow,
  useRoomSectionDrop,
} from '../room-nav/SortableRoomList';
import { useMDirectContent } from '../../matrix/state/mDirectList';
import { mergeSearchRoomSources } from '../../matrix/state/useSpaceSearchRooms';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows, type SubRoomTree } from '../room-nav/SubRoomRows';
import { useDirectRooms } from '../direct/useDirectRooms';
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
import { CommandPaletteSearchField } from '../../command-palette/CommandPaletteSearchField';
import * as searchFieldCss from '../../ui/SearchField.css';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { getHomeCreatePath, getHomeRoomPath, withSearchParam } from '../../routes/pathUtils';
import { useRailButtons } from '../../settings/railButtons';
import { type RenderedSpaceRoomSection, SpaceRoomSection } from '../space/SpaceRoomSection';
import * as spaceSectionCss from '../space/SpaceRoomSection.css';
import { useHomeAgents } from './homeAgents';
import { HomeAgentsSection, HomeDirectSection } from './HomeDirectAndAgentSections';
import {
  HOME_AGENTS_CATEGORY_ID,
  HOME_DIRECT_CATEGORY_ID,
  selectRenderedAgents,
  selectRenderedDirectRooms,
  splitHomeDirectSections,
} from './homeDirectSections';
import {
  type HomeAddRoomsMenu,
  HomeAddRoomsRow,
  HomeEmptyRoomAction,
  HomeSectionHeader,
  useHomeAddRoomsMenu,
} from './HomeSectionChrome';
import * as homeSectionsCss from './HomeSections.css';
import { HomeHeader } from './HomeHeader';
import { useHomeRoomSections } from './useHomeRoomSections';

const ROOM_ROW_HEIGHT = 36;
const homePinMode = (section: RenderedSpaceRoomSection): 'toggle' | undefined =>
  section.ancestorSpaceIds.length > 0 ? 'toggle' : undefined;

type HomeUnspacedRoomsSectionProps = {
  roomsCategoryId: string;
  roomsClosed: boolean;
  listedRoomIds: string[];
  shownRoomIds: string[];
  selectedRoomId: string | undefined;
  tree: SubRoomTree;
  roomOrder: Pick<RoomOrder, 'mode' | 'save'>;
  virtualizer: ReturnType<typeof useNavVirtualizer<HTMLDivElement, Element>>;
  addRoomsMenu: HomeAddRoomsMenu;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  rowProps: (room: Room) => ComponentProps<typeof SortableRoomRow>;
  renderSubRoom: (room: Room) => ReactNode;
};

/** Home's unspaced Rooms section, registered as a droppable boundary inside Home's SortableRoomGroup. */
function HomeUnspacedRoomsSection({
  roomsCategoryId,
  roomsClosed,
  listedRoomIds,
  shownRoomIds,
  selectedRoomId,
  tree,
  roomOrder,
  virtualizer,
  addRoomsMenu,
  onCategoryClick,
  rowProps,
  renderSubRoom,
}: HomeUnspacedRoomsSectionProps) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const sectionDrop = useRoomSectionDrop(HOME_ROOM_LIST);

  return (
    <NavCategory data-testid="room-nav-category" {...sectionDrop}>
      <HomeSectionHeader
        label={t('nav.rooms')}
        categoryId={roomsCategoryId}
        closed={roomsClosed}
        roomIds={shownRoomIds}
        selectedRoomId={selectedRoomId}
        onCategoryClick={onCategoryClick}
        addAction={{
          label: t('featureUi.homeNav.addRooms'),
          hasMenu: true,
          menuOpen: addRoomsMenu.source === 'header',
          onClick: addRoomsMenu.openFromHeader,
        }}
      />
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
      {!roomsClosed && <HomeAddRoomsRow addRoomsMenu={addRoomsMenu} />}
    </NavCategory>
  );
}

/** The Home navigation: rooms, space sections, direct messages, agents, threads, and recently opened. */
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
  const [joinPrompt, setJoinPrompt] = useState<{ returnFocusTo?: HTMLElement | null } | null>(null);
  const [showAllDms, setShowAllDms] = useState(false);

  const {
    allVisibleHomeRooms,
    unspaced,
    closedCategories,
    roomsCategoryId,
    roomsClosed,
    unspacedShownRoomIds,
    tree,
    listedRoomIds,
    roomOrder,
    sectionTree,
    shortcutRoomIds,
    onCategoryClick,
    onReorder,
  } = useHomeRoomSections(selectedRoomId);
  const directRooms = useDirectRooms();
  const homeAgents = useHomeAgents();
  const mDirect = useMDirectContent();
  const { direct: directTabShown } = useRailButtons();

  const { humanDms, agents, agentDmRoomIds } = useMemo(
    () => splitHomeDirectSections(directRooms, homeAgents, mDirect),
    [directRooms, homeAgents, mDirect]
  );
  const humanDmRoomIds = useMemo(() => humanDms.map((room) => room.roomId), [humanDms]);
  const directClosed = closedCategories.has(HOME_DIRECT_CATEGORY_ID);
  const agentsClosed = closedCategories.has(HOME_AGENTS_CATEGORY_ID);
  const showDirectSection = directRooms.length > 0 || !directTabShown;
  const isEmptyHome =
    unspaced.length === 0 &&
    sectionTree.length === 0 &&
    humanDms.length === 0 &&
    agents.length === 0;

  const visibleDirectRooms = useMemo(
    () => selectRenderedDirectRooms(humanDms, selectedRoomId, directClosed, showAllDms),
    [humanDms, selectedRoomId, directClosed, showAllDms]
  );
  const visibleAgents = useMemo(
    () => selectRenderedAgents(agents, selectedRoomId, agentsClosed),
    [agents, selectedRoomId, agentsClosed]
  );

  const allShortcutRoomIds = useMemo(
    () =>
      mergeSearchRoomSources(
        shortcutRoomIds,
        visibleDirectRooms.map((room) => room.roomId),
        visibleAgents.flatMap((agent) => (agent.dmRoom ? [agent.dmRoom.roomId] : []))
      ),
    [shortcutRoomIds, visibleDirectRooms, visibleAgents]
  );
  const allMarkReadRoomIds = useMemo(
    () => mergeSearchRoomSources(allVisibleHomeRooms, humanDmRoomIds, agentDmRoomIds),
    [allVisibleHomeRooms, humanDmRoomIds, agentDmRoomIds]
  );

  const homeRoomPath = useCallback(
    (roomId: string) => getHomeRoomPath(getCanonicalAliasOrRoomId(client, roomId)),
    [client]
  );
  useRoomListShortcuts(allShortcutRoomIds, selectedRoomId, homeRoomPath);
  const addRoomsMenu = useHomeAddRoomsMenu({
    onCreate: () => void navigate(getHomeCreatePath()),
    onJoin: (opener) => setJoinPrompt({ returnFocusTo: opener }),
  });

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
    setJoinPrompt(null);
    void navigate(
      withSearchParam(getHomeRoomPath(roomIdOrAlias, eventId), {
        viaServers: viaServers && viaServers.length > 0 ? viaServers.join(',') : undefined,
      })
    );
  };

  const emptyRoomActions = (
    <NavCategory>
      {!phone && <CommandPaletteSearchField className={searchFieldCss.NavSearchField} />}
      <HomeEmptyRoomAction
        action="create"
        icon={Icons.Plus}
        label={t('nav.createRoom')}
        selected={createSelected}
        onSelect={() => void navigate(getHomeCreatePath())}
      />
      <HomeEmptyRoomAction
        action="join"
        icon={Icons.Link}
        label={t('sharedUi.joinAddressPrompt.joinARoom')}
        onSelect={() => setJoinPrompt({})}
      />
    </NavCategory>
  );

  return (
    <PageNav label={t('nav.home')}>
      {joinPrompt && (
        <JoinAddressPrompt
          returnFocusTo={joinPrompt.returnFocusTo}
          onOpen={handleJoinOpen}
          onCancel={() => setJoinPrompt(null)}
        />
      )}
      {addRoomsMenu.popover}
      <PageNavContent
        scrollRef={listScrollRef}
        header={
          <HomeHeader
            roomIds={allMarkReadRoomIds}
            sort={unspaced.length > 0 ? roomOrder : undefined}
          />
        }
      >
        {isEmptyHome ? (
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
            options={emptyRoomActions}
          />
        ) : (
          <Box direction="Column" gap="300">
            {!phone && (
              <CommandPaletteSearchField className={homeSectionsCss.PopulatedSearchField} />
            )}
            {(unspaced.length > 0 || sectionTree.length > 0) && (
              <SortableRoomGroup>
                {unspaced.length > 0 && (
                  <HomeUnspacedRoomsSection
                    roomsCategoryId={roomsCategoryId}
                    roomsClosed={roomsClosed}
                    listedRoomIds={listedRoomIds}
                    shownRoomIds={unspacedShownRoomIds}
                    selectedRoomId={selectedRoomId}
                    tree={tree}
                    roomOrder={roomOrder}
                    virtualizer={virtualizer}
                    addRoomsMenu={addRoomsMenu}
                    onCategoryClick={onCategoryClick}
                    rowProps={rowProps}
                    renderSubRoom={renderSubRoom}
                  />
                )}
                {sectionTree.length > 0 && (
                  <div className={spaceSectionCss.SpaceSectionStack}>
                    {sectionTree.map((node) => (
                      <SpaceRoomSection
                        key={node.section.categoryId}
                        section={node.section}
                        childNodes={node.children}
                        subtreeShownRoomIds={node.subtreeShownRoomIds}
                        spaceId={node.section.spaceId}
                        spaceIdOrAlias={node.section.spaceId}
                        selectedRoomId={selectedRoomId}
                        onCategoryClick={onCategoryClick}
                        onReorder={onReorder}
                        roomPath={getHomeRoomPath}
                        showOverview
                        quietUnread
                        pinMode={homePinMode}
                      />
                    ))}
                  </div>
                )}
              </SortableRoomGroup>
            )}
            {unspaced.length === 0 && (
              <NavCategory>
                <HomeAddRoomsRow addRoomsMenu={addRoomsMenu} />
              </NavCategory>
            )}
            {showDirectSection && (
              <HomeDirectSection
                visibleRooms={visibleDirectRooms}
                allRoomIds={humanDmRoomIds}
                closed={directClosed}
                selectedRoomId={selectedRoomId}
                showAll={showAllDms}
                onToggleShowAll={() => setShowAllDms((prev) => !prev)}
                onCategoryClick={onCategoryClick}
                homeRoomPath={homeRoomPath}
                notificationPreferences={notificationPreferences}
              />
            )}
            {agents.length > 0 && (
              <HomeAgentsSection
                visibleAgents={visibleAgents}
                agentDmRoomIds={agentDmRoomIds}
                closed={agentsClosed}
                selectedRoomId={selectedRoomId}
                onCategoryClick={onCategoryClick}
                homeRoomPath={homeRoomPath}
                notificationPreferences={notificationPreferences}
              />
            )}
            <ThreadNavCategory />
          </Box>
        )}
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
