import React, { MouseEventHandler, ReactNode, useMemo, useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
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
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceLobbyPath,
  getSpaceRoomPath,
  getSpaceSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { RouteResolving } from '../RoomRoute';
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

/**
 * The `/:spaceIdOrAlias/` routes: the joined space as context for its pages.
 * The same shape is the app's room link (`/<room>` and `/<room>/<$event>`,
 * what matrix-to links open), so a room or an event goes to its room route.
 */
export function SpaceRouteProvider({ children }: { children: ReactNode }) {



  const { spaceIdOrAlias: encoded, roomIdOrAlias: encodedSecond } = useParams();
  const spaceIdOrAlias = encoded ? decodeURIComponent(encoded) : '';
  const second = encodedSecond ? decodeURIComponent(encodedSecond) : undefined;
  const { roomId, isResolvingAlias } = useResolvedRoomIdOrAlias(spaceIdOrAlias);
  const room = mx.getRoom(roomId ?? '');
  const joined = room?.getMyMembership() === KnownMembership.Join;
  const eventId = second?.startsWith('$') ? second : undefined;
  const viaServers = readViaServers(searchParams);

  // An alias the client does not know yet resolves through the server first.
  if (isResolvingAlias) return <RouteResolving />;

  if (eventId || (joined && room && !room.isSpaceRoom())) {
    const path =
      room && directs.has(room.roomId)
        ? getDirectRoomPath(spaceIdOrAlias, eventId)
        : getHomeRoomPath(spaceIdOrAlias, eventId);
    return <Navigate to={withSearchParam(path, { viaServers: viaServers?.join(',') })} replace />;
  }
  if (!room || !joined) {
    return (
      <JoinBeforeNavigate
        key={spaceIdOrAlias}
        roomIdOrAlias={spaceIdOrAlias}
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
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (event) =>
    setMenuAnchor(event.currentTarget.getBoundingClientRect());

  return (
    <PageNavHeader>
      <Box alignItems="Center" grow="Yes" gap="300">
        <Box grow="Yes">
          <Text size="H4" truncate>
            {name}
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

  const action = (key: string, icon: typeof Icons.Space, label: string, path: string) => (
    <NavItem key={key} variant="Background" radii="400">
      <NavButton onClick={() => navigate(path)}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              <Icon src={icon} size="100" />
            </Avatar>
            <Text as="span" size="Inherit" truncate>
              {label}
            </Text>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );

  return (
    <PageNav>
      <SpaceHeader name={name} roomIds={spaceRooms} />
      <PageNavContent>
        <Box direction="Column" gap="300">
          <NavCategory>
            {action(
              'lobby',
              Icons.Flag,
              t('sharedUi.space.lobby'),
              getSpaceLobbyPath(spaceIdOrAlias)
            )}
            {action(
              'search',
              Icons.Search,
              t('sharedUi.space.messageSearch'),
              getSpaceSearchPath(spaceIdOrAlias)
            )}
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
