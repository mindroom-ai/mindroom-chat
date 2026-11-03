import React, { MouseEventHandler, ReactNode, useMemo, useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import type { IconSrc, RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixClient } from 'matrix-js-sdk';
import { Menu } from '../../../components/glass/GlassPrimitives';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavItem,
  NavItemContent,
} from '../../../components/nav';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate/JoinBeforeNavigate';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../../hooks/router/useResolvedRoomIdOrAlias';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { SpaceProvider, useSpace } from '../../../hooks/useSpace';
import { useRoomName } from '../../../hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { stopPropagation } from '../../../utils/keyboard';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { mDirectAtom } from '../../../state/mDirectList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { getRoomSearchParams } from '../../pathSearchParam';
import {
  decodeRouteParam,
  getDirectRoomPath,
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
import { useSpaceSearchRooms } from './useSpaceSearchRooms';

const lastActivity = (mx: MatrixClient, roomId: string): number =>
  mx.getRoom(roomId)?.getLastActiveTimestamp?.() ?? 0;

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

function SpaceHeader({ name, roomIds }: { name: string; roomIds: string[] }) {
  const { t } = useTranslation();
  const [menuAt, setMenuAt] = useState<RectCords>();
  const dismiss = () => setMenuAt(undefined);
  const showMenu: MouseEventHandler<HTMLButtonElement> = (event) => {
    setMenuAt(event.currentTarget.getBoundingClientRect());
  };

  // Marking the space's rooms read is the menu's only entry.
  const menuContent = (
    <FocusTrap
      focusTrapOptions={{
        clickOutsideDeactivates: true,
        escapeDeactivates: stopPropagation,
        initialFocus: false,
        onDeactivate: dismiss,
        returnFocusOnDeactivate: false,
      }}
    >
      <Menu style={{ width: '100vw', maxWidth: toRem(160) }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={dismiss} />
        </Box>
      </Menu>
    </FocusTrap>
  );

  return (
    <PageNavHeader>
      <Box gap="300" grow="Yes" alignItems="Center">
        <Box grow="Yes">
          <Text truncate size="H4">
            {name}
          </Text>
        </Box>
        <IconButton
          variant="Background"
          aria-label={t('featureUi.lobby.lobbyHeader.moreOptions')}
          onClick={showMenu}
        >
          <Icon size="200" src={Icons.VerticalDots} />
        </IconButton>
        <PopOut anchor={menuAt} align="End" position="Bottom" offset={6} content={menuContent} />
      </Box>
    </PageNavHeader>
  );
}

/** A shortcut row at the top of the space navigation, opening one of the space's pages. */
function SpacePageLink({
  icon,
  label,
  onOpen,
}: {
  icon: IconSrc;
  label: string;
  onOpen: () => void;
}) {
  return (
    <NavItem radii="400" variant="Background">
      <NavButton onClick={onOpen}>
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
      </NavButton>
    </NavItem>
  );
}

/** The navigation of a space: lobby, message search, its rooms, threads, and recently opened. */







  const spaceRooms = useSpaceSearchRooms(space.roomId);
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();
  const [roomsClosed, setRoomsClosed] = useState(false);
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);

  const sortedRooms = useMemo(() => {
    const items = [...spaceRooms].sort((a, b) => lastActivity(mx, b) - lastActivity(mx, a));
    // A collapsed category still shows the selected room.
    return roomsClosed ? items.filter((roomId) => roomId === selectedRoomId) : items;
  }, [mx, spaceRooms, roomsClosed, selectedRoomId]);

  return (
    <PageNav>
      <SpaceHeader name={name} roomIds={spaceRooms} />
      <PageNavContent>
        <Box direction="Column" gap="300">
          <NavCategory>
            <SpacePageLink
              icon={Icons.Flag}
              label={t('sharedUi.space.lobby')}
              onOpen={() => navigate(getSpaceLobbyPath(spaceIdOrAlias))}
            />
            <SpacePageLink
              icon={Icons.Search}
              label={t('sharedUi.space.messageSearch')}
              onOpen={() => navigate(getSpaceSearchPath(spaceIdOrAlias))}
            />
          </NavCategory>
          <NavCategory>
            <NavCategoryHeader>
              <RoomNavCategoryButton closed={roomsClosed} onClick={() => setRoomsClosed((c) => !c)}>
                {t('sharedUi.space.rooms')}
              </RoomNavCategoryButton>
            </NavCategoryHeader>








                  linkPath={getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(mx, roomId))}
                  notificationMode={getRoomNotificationMode(notificationPreferences, roomId)}
                />
              );
            })}
          </NavCategory>
          <ThreadNavCategory spaceId={space.roomId} />
        </Box>
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
