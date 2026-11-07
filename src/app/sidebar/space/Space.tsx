import { Fragment, ReactNode, Suspense, lazy, useMemo, useState } from 'react';
import { Avatar, Box, Icon, Icons, Line, Text } from 'folds';
import type { IconSrc } from 'folds';
import { Navigate, useMatch, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { PageNav, PageNavContent, PageNavHeader } from '../../ui/page/Page';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { NavButton, NavCategory, NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
import { useRoomOrder } from '../room-nav/roomOrder';
import { SortableRoomList, SortableRoomRow } from '../room-nav/SortableRoomList';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows, nestSubRooms, withSubRooms } from '../room-nav/SubRoomRows';
import { chatRoomParentsAtom, roomToParentsAtom } from '../../matrix/state/roomToParents';
import { JoinBeforeNavigate } from '../../rooms/join/JoinBeforeNavigate';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../navigation/useResolvedRoomIdOrAlias';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import { useNavToActivePathMapper } from '../../routes/useNavToActivePathMapper';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { SpaceProvider, useSpace } from '../../matrix/hooks/useSpace';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { copyToClipboard } from '../../lib/dom';
import { useOpenSpaceSettings } from '../../navigation/useSpaceSettingsState';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { ThreadNavCategory } from '../threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../threads/RecentlyOpenedNavCategory';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { commandPaletteOpenAtom } from '../../command-palette/commandPaletteState';
import { useRoomListShortcuts } from '../useRoomListShortcuts';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { getRoomSearchParams } from '../../routes/pathSearchParam';
import { SPACE_LOBBY_PATH } from '../../routes/paths';
import {
  decodeRouteParam,
  getDirectRoomPath,
  getHomePath,
  getHomeRoomPath,
  getRootPath,
  getSpaceLobbyPath,
  getSpacePath,
  getSpaceRoomPath,
  withSearchParam,
} from '../../routes/pathUtils';
import { useClientStartupContext } from '../../matrix/ClientStartupContext';
import { RouteResolving } from '../../room/RoomRoute';
import {
  canRenderRoutedRoom,
  shouldDeferRoomRouteFallback,
} from '../../navigation/routeVisibility';
import {
  useJoinedParentSpaces,
  useJoinedSubspaces,
  useSpaceNavigationRooms,
  useSpaceOwnRooms,
} from '../../matrix/state/useSpaceSearchRooms';
import { BackToListButton } from '../../ui/page/PhoneBackButton';
import { SubspacesMenu } from './SubspacesMenu';
import { getSpaceShareLink } from './spaceLink';
import { sortRoomIdsByName } from '../../lib/nameOrder';

/** Servers to join through, from `?via=` (app links) or `?viaServers=` (app routes). */
const readViaServers = (searchParams: URLSearchParams): string[] | undefined => {
  const via = [
    ...searchParams.getAll('via'),
    ...(searchParams.get('viaServers')?.split(',') ?? []),
  ].filter(Boolean);
  return via.length > 0 ? via : undefined;
};

/** Room IDs start with `!` and aliases with `#`; any other first segment is no space. */
const isRoomIdOrAliasSegment = (value: string): boolean => /^[!#]/.test(value);

/**
 * The `/:spaceIdOrAlias/` routes: the joined space as context for its pages.
 * The same shape is the app's room link (`/<room>` and `/<room>/<$event>`,
 * what matrix-to links open), so a room or an event goes to its room route.
 * The joined rooms list re-renders the route when a join lands.
 */
export function SpaceRouteProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const directs = useAtomValue(mDirectAtom);
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const { hasCompletedInitialSync } = useClientStartupContext();
  const [searchParams] = useSearchParams();
  const { spaceIdOrAlias: encoded, roomIdOrAlias: encodedSecond } = useParams();
  const spaceIdOrAlias = encoded ? decodeRouteParam(encoded) : '';
  const second = encodedSecond ? decodeRouteParam(encodedSecond) : undefined;
  const { roomId, isResolvingAlias } = useResolvedRoomIdOrAlias(spaceIdOrAlias);
  const room = mx.getRoom(roomId ?? '');
  const joined = canRenderRoutedRoom(room, joinedRoomIds);
  const eventId = second?.startsWith('$') ? second : undefined;
  const viaServers = readViaServers(searchParams);
  const { threadId } = getRoomSearchParams(searchParams);

  if (!isRoomIdOrAliasSegment(spaceIdOrAlias)) return <Navigate to={getRootPath()} replace />;

  // An alias the client does not know yet resolves through the server first.
  if (isResolvingAlias) return <RouteResolving />;

  if (eventId || (joined && room && !room.isSpaceRoom())) {
    const path =
      room && directs.has(room.roomId)
        ? getDirectRoomPath(spaceIdOrAlias, eventId)
        : getHomeRoomPath(spaceIdOrAlias, eventId);
    return (
      <Navigate
        to={withSearchParam(path, { viaServers: viaServers?.join(','), threadId })}
        replace
      />
    );
  }
  // Before the first sync a space missing from the cache may still turn out to be joined.
  if (
    shouldDeferRoomRouteFallback({
      hasCompletedInitialSync,
      isResolvingAlias,
      room,
      routedRoomIds: joinedRoomIds,
    })
  ) {
    return <RouteResolving />;
  }
  if (!room || !joined) {
    return (
      <JoinBeforeNavigate
        key={spaceIdOrAlias}
        roomIdOrAlias={spaceIdOrAlias}
        threadId={threadId}
        viaServers={viaServers}
      />
    );
  }
  return (
    <SpaceProvider key={room.roomId} value={room}>
      {children}
    </SpaceProvider>
  );
}

/** The space's title bar: its name, and a menu for its rooms and its settings. */
// The invite dialog loads the first time someone opens it.
const InviteUserPrompt = lazy(() =>
  import('../../members/invite/InviteUserPrompt').then((module) => ({
    default: module.InviteUserPrompt,
  }))
);

// Like the invite dialog, the leave prompt loads when first opened.
const LeaveSpacePrompt = lazy(() =>
  import('../../spaces/LeaveSpacePrompt').then((module) => ({
    default: module.LeaveSpacePrompt,
  }))
);

type SpaceHeaderProps = {
  /** The space's rooms, which Mark as Read covers. */
  roomIds: string[];
  /** Puts the hand-ordered Rooms back in A to Z order; only while they are ordered by hand. */
  onSortByName?: () => void;
};

/** A sub-space's way back to the room list of the space that holds it. */
function ParentSpaceBack({ parent, others }: { parent: Room; others: Room[] }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const name = revealDirectionControls(useRoomName(parent));
  const listPath = (room: Room) => getSpacePath(getCanonicalAliasOrRoomId(client, room.roomId));
  return (
    <BackToListButton
      to={listPath(parent)}
      openedFrom={others.map(listPath)}
      label={t('featureUi.spaceNav.backToParent', { name })}
    />
  );
}

function SpaceHeader({ roomIds, onSortByName }: SpaceHeaderProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const space = useSpace();
  const name = revealDirectionControls(useRoomName(space));
  const permissions = useRoomPermissions(useRoomCreators(space), usePowerLevels(space));
  const canInvite = permissions.action('invite', client.getUserId() ?? '');
  const openSpaceSettings = useOpenSpaceSettings();
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();
  const [parent, ...otherParents] = useJoinedParentSpaces(space.roomId).flatMap(
    (roomId) => client.getRoom(roomId) ?? []
  );
  return (
    <PageNavHeader>
      <Box gap="300" grow="Yes" alignItems="Center">
        {parent && <ParentSpaceBack parent={parent} others={otherParents} />}
        <Box grow="Yes">
          {/* Not a heading: the lobby's hero names the space as its h2 (page-header-glass). */}
          <Text truncate size="H4" {...ownDirectionLine}>
            {name}
          </Text>
        </Box>
        {/* Mark the space's rooms read, invite people where allowed, or open the space's settings. */}
        <NavOptionsMenu label={t('featureUi.spaceNav.options')} width={200}>
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
                {canInvite && (
                  <MenuEntry
                    label={t('sharedUi.space.invite')}
                    icon={Icons.UserPlus}
                    onSelect={() => {
                      close();
                      setInviting(true);
                    }}
                  />
                )}
                <MenuEntry
                  label={t('sharedUi.space.copyLink')}
                  icon={Icons.Link}
                  onSelect={() => {
                    close();
                    void copyToClipboard(getSpaceShareLink(client, space));
                  }}
                />
                <MenuEntry
                  label={t('featureUi.lobby.lobbyHeader.spaceSettings')}
                  icon={Icons.Setting}
                  onSelect={() => {
                    close();
                    openSpaceSettings(space.roomId);
                  }}
                />
              </MenuGroup>
              <Line size="300" />
              <MenuGroup>
                <MenuEntry
                  label={t('sharedUi.space.leaveSpace')}
                  icon={Icons.ArrowGoLeft}
                  directional
                  critical
                  onSelect={() => {
                    close();
                    setLeaving(true);
                  }}
                />
              </MenuGroup>
            </>
          )}
        </NavOptionsMenu>
      </Box>
      {inviting && (
        <Suspense fallback={null}>
          <InviteUserPrompt room={space} requestClose={() => setInviting(false)} />
        </Suspense>
      )}
      {leaving && (
        <Suspense fallback={null}>
          <LeaveSpacePrompt
            roomId={space.roomId}
            requestClose={() => setLeaving(false)}
            onLeft={() => {
              setLeaving(false);
              navigate(getHomePath());
            }}
          />
        </Suspense>
      )}
    </PageNavHeader>
  );
}

/** A shortcut row at the top of the space navigation, linking to one of the space's pages. */
type SpacePageLinkProps = { icon: IconSrc; label: string; selected?: boolean } & (
  | { to: string; onSelect?: undefined }
  | { onSelect: () => void; to?: undefined }
);

/** One of the shortcuts above the space's rooms: a link when it opens a page, else a button. */
function SpacePageLink({ icon, label, to, onSelect, selected }: SpacePageLinkProps) {
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
        <NavButton onClick={onSelect}>{content}</NavButton>
      ) : (
        <NavLink to={to}>{content}</NavLink>
      )}
    </NavItem>
  );
}

/** The navigation of a space: lobby, message search, its rooms, threads, and recently opened. */
export function Space() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const space = useSpace();
  const title = revealDirectionControls(useRoomName(space));
  // On a phone, opening the list keeps the remembered room for the next visit.
  useNavToActivePathMapper(space.roomId, true);
  // Mark as Read covers the rooms of the sub-spaces too; the list shows the space's own rooms,
  // with their sub-rooms.
  const spaceRooms = useVisibleRooms(useSpaceNavigationRooms(space.roomId));
  const ownRooms = useVisibleRooms(useSpaceOwnRooms(space.roomId));
  const joinedSubspaces = useJoinedSubspaces(space.roomId);
  // A to Z, like the rooms: the joined-rooms order shifts while the client syncs.
  const subspaceIds = useMemo(
    () => sortRoomIdsByName(client, joinedSubspaces),
    [client, joinedSubspaces]
  );
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();
  const [roomsClosed, setRoomsClosed] = useState(false);
  const openCommandPalette = useSetAtom(commandPaletteOpenAtom);
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(client, space.roomId);
  const lobbySelected = useMatch(SPACE_LOBBY_PATH) !== null;

  const roomToParents = useAtomValue(roomToParentsAtom);
  const chatRooms = useAtomValue(chatRoomParentsAtom);
  const roomsByName = useMemo(() => sortRoomIdsByName(client, ownRooms), [client, ownRooms]);
  // The sub-rooms of the space's own rooms show under them, A to Z.
  const tree = useMemo(
    () =>
      nestSubRooms(roomsByName, sortRoomIdsByName(client, spaceRooms), roomToParents, chatRooms),
    [client, roomsByName, spaceRooms, roomToParents, chatRooms]
  );
  // Like Home: A to Z until the person drags a room, then their order.
  const roomOrder = useRoomOrder(space.roomId, tree.top);
  const shownRoomIds = useMemo(
    () => withSubRooms(roomOrder.roomIds, tree),
    [roomOrder.roomIds, tree]
  );
  const sortedRooms = useMemo(
    () =>
      // A collapsed category still shows the selected room, on its own.
      roomsClosed ? shownRoomIds.filter((roomId) => roomId === selectedRoomId) : roomOrder.roomIds,
    [shownRoomIds, roomOrder.roomIds, roomsClosed, selectedRoomId]
  );
  const spaceRoomPath = (roomId: string) =>
    getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(client, roomId));
  useRoomListShortcuts(roomsClosed ? sortedRooms : shownRoomIds, selectedRoomId, spaceRoomPath);
  // A room's row, the same at top level and under the room it sits under.
  const rowProps = (room: Room) => ({
    room,
    selected: room.roomId === selectedRoomId,
    linkPath: spaceRoomPath(room.roomId),
    notificationMode: getRoomNotificationMode(notificationPreferences, room.roomId),
    spaceId: space.roomId,
  });
  const renderSubRoom = (room: Room) => <RoomNavItem {...rowProps(room)} />;
  const previewPath = (roomId: string) => getSpaceRoomPath(spaceIdOrAlias, roomId);

  return (
    <PageNav label={title}>
      <PageNavContent
        header={
          <SpaceHeader
            roomIds={spaceRooms}
            onSortByName={roomOrder.manual ? roomOrder.reset : undefined}
          />
        }
      >
        <Box direction="Column" gap="300">
          <NavCategory>
            <SpacePageLink
              icon={Icons.Flag}
              label={t('sharedUi.space.lobby')}
              to={getSpaceLobbyPath(spaceIdOrAlias)}
              selected={lobbySelected}
            />
            {/* Message search is the command palette's Messages tab, as on Home. */}
            <SpacePageLink
              icon={Icons.Search}
              label={t('sharedUi.space.messageSearch')}
              onSelect={() => openCommandPalette('messages')}
            />
            {subspaceIds.length > 0 && <SubspacesMenu subspaceIds={subspaceIds} />}
          </NavCategory>
          <NavCategory>
            <NavCategoryHeader>
              <RoomNavCategoryButton closed={roomsClosed} onClick={() => setRoomsClosed((c) => !c)}>
                {t('sharedUi.space.rooms')}
              </RoomNavCategoryButton>
            </NavCategoryHeader>
            <SortableRoomList
              listId={space.roomId}
              roomIds={sortedRooms}
              onReorder={roomOrder.save}
            >
              {sortedRooms.map((roomId) => {
                const room = client.getRoom(roomId);
                return room ? (
                  <Fragment key={roomId}>
                    <SortableRoomRow {...rowProps(room)} />
                    {!roomsClosed && (
                      <SubRoomRows
                        parent={room}
                        tree={tree}
                        renderRoom={renderSubRoom}
                        previewPath={previewPath}
                      />
                    )}
                  </Fragment>
                ) : null;
              })}
            </SortableRoomList>
          </NavCategory>
          <ThreadNavCategory spaceId={space.roomId} />
        </Box>
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
