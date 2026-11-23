import { ReactNode, Suspense, lazy, useState } from 'react';
import { Avatar, Box, Icon, Icons, Line, Text } from 'folds';
import type { IconSrc } from 'folds';
import { Navigate, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { PageNav, PageNavContent, PageNavHeader } from '../../ui/page/Page';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { NavCategory, NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import { useRoomListShortcuts } from '../useRoomListShortcuts';
import { JoinBeforeNavigate } from '../../rooms/join/JoinBeforeNavigate';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../navigation/useResolvedRoomIdOrAlias';
import { useRoomRouteParams } from '../../navigation/useRoomRouteParams';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import { useNavToActivePathMapper } from '../../routes/useNavToActivePathMapper';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { SpaceProvider, useSpace } from '../../matrix/hooks/useSpace';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { copyToClipboard } from '../../lib/dom';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { ThreadNavCategory } from '../threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../threads/RecentlyOpenedNavCategory';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { CommandPaletteSearchField } from '../../command-palette/CommandPaletteSearchField';
import * as searchFieldCss from '../../command-palette/CommandPaletteSearchField.css';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { getRoomSearchParams } from '../../routes/pathSearchParam';
import { SPACE_LOBBY_PATH } from '../../routes/paths';
import {
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
import { useJoinedParentSpaces } from '../../matrix/state/useSpaceSearchRooms';
import { BackToListButton } from '../../ui/page/PhoneBackButton';
import { getSpaceShareLink } from './spaceLink';
import { SpaceRoomSection, useSpaceRoomSections } from './SpaceRoomSection';

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
  const { spaceIdOrAlias = '', roomIdOrAlias: second } = useRoomRouteParams();
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
const LeaveRoomPrompt = lazy(() =>
  import('../../rooms/LeaveRoomPrompt').then((module) => ({
    default: module.LeaveRoomPrompt,
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
  const openSpaceSettings = useOpenRoomSettings();
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
          <LeaveRoomPrompt
            roomId={space.roomId}
            requestClose={() => setLeaving(false)}
            onLeft={() => {
              setLeaving(false);
              void navigate(getHomePath());
            }}
          />
        </Suspense>
      )}
    </PageNavHeader>
  );
}

/** A shortcut row at the top of the space navigation, linking to one of the space's pages. */
type SpacePageLinkProps = { icon: IconSrc; label: string; to: string; selected?: boolean };

/** One of the shortcuts above the space's rooms, linking to one of its pages. */
function SpacePageLink({ icon, label, to, selected }: SpacePageLinkProps) {
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
      <NavLink to={to}>{content}</NavLink>
    </NavItem>
  );
}

/** The navigation of a space: search, lobby, its rooms and sub-space sections, threads, and recently opened. */
export function Space() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const space = useSpace();
  const title = revealDirectionControls(useRoomName(space));
  // On a phone, opening the list keeps the remembered room for the next visit.
  useNavToActivePathMapper(space.roomId, true);
  const selectedRoomId = useSelectedRoom();
  // A phone's top bar holds the same field.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(client, space.roomId);
  const lobbySelected = useMatch(SPACE_LOBBY_PATH) !== null;

  const { spaceRooms, sections, shortcutRoomIds, onCategoryClick, onReorder, onSortByName } =
    useSpaceRoomSections(space.roomId, selectedRoomId);
  const spaceRoomPath = (roomId: string) =>
    getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(client, roomId));
  useRoomListShortcuts(shortcutRoomIds, selectedRoomId, spaceRoomPath);

  return (
    <PageNav label={title}>
      <PageNavContent header={<SpaceHeader roomIds={spaceRooms} onSortByName={onSortByName} />}>
        <Box direction="Column" gap="300">
          <NavCategory>
            {!phone && <CommandPaletteSearchField className={searchFieldCss.NavSearchField} />}
            <SpacePageLink
              icon={Icons.Category}
              label={t('sharedUi.space.overview')}
              to={getSpaceLobbyPath(spaceIdOrAlias)}
              selected={lobbySelected}
            />
          </NavCategory>
          {sections.map((section) => (
            <SpaceRoomSection
              key={section.categoryId}
              section={section}
              spaceId={space.roomId}
              spaceIdOrAlias={spaceIdOrAlias}
              selectedRoomId={selectedRoomId}
              onCategoryClick={onCategoryClick}
              onReorder={onReorder}
            />
          ))}
          <ThreadNavCategory spaceId={space.roomId} />
        </Box>
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
