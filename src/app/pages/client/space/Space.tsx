import { ReactNode, Suspense, lazy, useMemo, useState } from 'react';
import { Avatar, Box, Icon, Icons, Line, Text } from 'folds';
import type { IconSrc } from 'folds';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import {
  NavCategory,
  NavCategoryHeader,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import { RoomNavCategoryButton } from '../../../features/room-nav';
import { useRoomOrder } from '../../../features/room-nav/roomOrder';
import { SortableRoomList, SortableRoomRow } from '../../../features/room-nav/SortableRoomList';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate/JoinBeforeNavigate';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../../hooks/router/useResolvedRoomIdOrAlias';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { SpaceProvider, useSpace } from '../../../hooks/useSpace';
import { useRoomName } from '../../../hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { copyToClipboard } from '../../../utils/dom';
import { useOpenSpaceSettings } from '../../../state/hooks/spaceSettings';
import { useVisibleRooms } from '../../../mindroom/rooms/archivedRooms';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { MenuEntry, MenuGroup } from '../../../components/MenuEntry';
import { NavOptionsMenu } from '../NavOptionsMenu';
import { mDirectAtom } from '../../../state/mDirectList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { getRoomSearchParams } from '../../pathSearchParam';
import {
  decodeRouteParam,
  getDirectRoomPath,
  getHomePath,
  getHomeRoomPath,
  getRootPath,
  getSpaceLobbyPath,
  getSpaceRoomPath,
  getSpaceSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { useClientStartupContext } from '../ClientStartupContext';
import { RouteResolving } from '../RoomRoute';
import { canRenderRoutedRoom, shouldDeferRoomRouteFallback } from '../routeVisibility';
import { useSpaceNavigationRooms } from './useSpaceSearchRooms';
import { getSpaceShareLink } from './spaceLink';
import { sortRoomIdsByName } from '../../../utils/nameOrder';

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
  import('../../../components/invite-user-prompt').then((module) => ({
    default: module.InviteUserPrompt,
  }))
);

// Like the invite dialog, the leave prompt loads when first opened.
const LeaveSpacePrompt = lazy(() =>
  import('../../../components/leave-space-prompt').then((module) => ({
    default: module.LeaveSpacePrompt,
  }))
);

type SpaceHeaderProps = {
  /** The space's rooms, which Mark as Read covers. */
  roomIds: string[];
  /** Puts the hand-ordered Rooms back in A to Z order; only while they are ordered by hand. */
  onSortByName?: () => void;
};

function SpaceHeader({ roomIds, onSortByName }: SpaceHeaderProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const space = useSpace();
  const name = useRoomName(space);
  const permissions = useRoomPermissions(useRoomCreators(space), usePowerLevels(space));
  const canInvite = permissions.action('invite', client.getUserId() ?? '');
  const openSpaceSettings = useOpenSpaceSettings();
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();
  return (
    <PageNavHeader>
      <Box gap="300" grow="Yes" alignItems="Center">
        <Box grow="Yes">
          {/* Not a heading: the lobby's hero names the space as its h2 (page-header-glass). */}
          <Text truncate size="H4">
            {name}
          </Text>
        </Box>
        {/* Mark the space's rooms read, invite people where allowed, or open the space's settings. */}
        <NavOptionsMenu label={t('featureUi.spaceNav.options')} width={200}>
          {(close) => (
            <>
              <MenuGroup>
                <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={close} />
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
function SpacePageLink({ icon, label, to }: { icon: IconSrc; label: string; to: string }) {
  return (
    <NavItem radii="400" variant="Background">
      <NavLink to={to}>
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
      </NavLink>
    </NavItem>
  );
}

/** The navigation of a space: lobby, message search, its rooms, threads, and recently opened. */
export function Space() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const space = useSpace();
  const title = useRoomName(space);
  // On a phone, opening the list keeps the remembered room for the next visit.
  useNavToActivePathMapper(space.roomId, true);
  const spaceRooms = useVisibleRooms(useSpaceNavigationRooms(space.roomId));
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();
  const [roomsClosed, setRoomsClosed] = useState(false);
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(client, space.roomId);

  const roomsByName = useMemo(() => sortRoomIdsByName(client, spaceRooms), [client, spaceRooms]);
  // Like Home: A to Z until the person drags a room, then their order.
  const roomOrder = useRoomOrder(space.roomId, roomsByName);
  const sortedRooms = useMemo(
    () =>
      // A collapsed category still shows the selected room.
      roomsClosed
        ? roomOrder.roomIds.filter((roomId) => roomId === selectedRoomId)
        : roomOrder.roomIds,
    [roomOrder.roomIds, roomsClosed, selectedRoomId]
  );

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
            />
            <SpacePageLink
              icon={Icons.Search}
              label={t('sharedUi.space.messageSearch')}
              to={getSpaceSearchPath(spaceIdOrAlias)}
            />
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
                  <SortableRoomRow
                    key={roomId}
                    room={room}
                    selected={roomId === selectedRoomId}
                    linkPath={getSpaceRoomPath(
                      spaceIdOrAlias,
                      getCanonicalAliasOrRoomId(client, roomId)
                    )}
                    notificationMode={getRoomNotificationMode(notificationPreferences, roomId)}
                  />
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
