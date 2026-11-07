import { Fragment, type ReactNode } from 'react';
import { Avatar, Box, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type Room } from 'matrix-js-sdk';
import { NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { RoomIcon } from '../../avatars/RoomAvatar';
import { RoomSummaryLoader } from '../../rooms/RoomSummaryLoader';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useStateEvents } from '../../matrix/hooks/useStateEvents';
import { isRoomId } from '../../matrix/matrix';
import { StateEvent, type RoomToParents } from '../../matrix/types/room';

/** A section's rooms: the ones it shows on their own, and the sub-rooms under each room. */
export type SubRoomTree = { top: string[]; children: ReadonlyMap<string, string[]> };

/**
 * Nests the sub-rooms of a sidebar section under the rooms that list them (`roomToParentsAtom`).
 * `topRoomIds` are the rooms the section shows on their own and `roomIds` every room it may show
 * under them, each in the order the section shows them. A room shows once: under the first of its
 * parents in the section, else on its own when it is one of `topRoomIds`. Of rooms that list each
 * other in a loop, the first shows on its own.
 */
export const nestSubRooms = (
  topRoomIds: string[],
  roomIds: string[],
  roomToParents: RoomToParents
): SubRoomTree => {
  const inSection = new Set([...topRoomIds, ...roomIds]);
  const parentsInSection = (roomId: string) =>
    [...(roomToParents.get(roomId) ?? [])].filter((id) => id !== roomId && inSection.has(id));
  const listedUnder = new Map<string, string[]>();
  roomIds.forEach((roomId) =>
    parentsInSection(roomId).forEach((parentId) =>
      listedUnder.set(parentId, [...(listedUnder.get(parentId) ?? []), roomId])
    )
  );

  const placed = new Set<string>();
  const children = new Map<string, string[]>();
  const place = (roomId: string) => {
    placed.add(roomId);
    const under = (listedUnder.get(roomId) ?? []).filter((id) => !placed.has(id));
    under.forEach((id) => placed.add(id));
    if (under.length > 0) children.set(roomId, under);
    under.forEach(place);
  };
  const top = topRoomIds.filter((roomId) => parentsInSection(roomId).length === 0);
  top.forEach(place);
  topRoomIds.forEach((roomId) => {
    if (placed.has(roomId)) return;
    top.push(roomId);
    place(roomId);
  });
  return { top, children };
};

/** `roomIds` with the sub-rooms of each after it, in the order the section shows them. */
export const withSubRooms = (roomIds: string[], tree: SubRoomTree): string[] =>
  roomIds.flatMap((roomId) => [roomId, ...withSubRooms(tree.children.get(roomId) ?? [], tree)]);

const viaOf = (content: Record<string, unknown>): string[] => {
  const { via } = content;
  return Array.isArray(via)
    ? via.filter((server): server is string => typeof server === 'string')
    : [];
};

type RoomToJoinRowProps = {
  roomId: string;
  viaServers: string[];
  to: string;
};

/**
 * A room listed under a room the user is in, but not joined: its name from the room's summary,
 * linking to its preview, which joins it.
 */
function RoomToJoinRow({ roomId, viaServers, to }: RoomToJoinRowProps) {
  const { t } = useTranslation();
  return (
    <RoomSummaryLoader roomIdOrAlias={roomId} viaServers={viaServers}>
      {(state) => {
        const summary = state.status === AsyncStatus.Success ? state.data : undefined;
        const name = revealDirectionControls(summary?.name ?? roomId);
        return (
          <NavItem variant="Background" radii="400" data-sub-room-to-join={roomId}>
            <NavLink to={to}>
              <NavItemContent>
                <Box as="span" grow="Yes" alignItems="Center" gap="200">
                  <Avatar size="200" radii="400" style={{ opacity: config.opacity.P300 }}>
                    <RoomIcon size="100" joinRule={summary?.join_rule} />
                  </Avatar>
                  <Box as="span" grow="Yes">
                    <Text as="span" size="Inherit" priority="300" truncate {...ownDirectionLine}>
                      {name}
                    </Text>
                  </Box>
                  <Text as="span" size="T200" priority="300">
                    {t('featureUi.lobby.roomItem.join')}
                  </Text>
                </Box>
              </NavItemContent>
            </NavLink>
          </NavItem>
        );
      }}
    </RoomSummaryLoader>
  );
}

type SubRoomRowsProps = {
  parent: Room;
  tree: SubRoomTree;
  /** Draws a joined sub-room's row, as the section draws its rooms. */
  renderRoom: (room: Room) => ReactNode;
  /** Where a listed room the user has not joined opens: its preview, through these servers. */
  previewPath: (roomId: string, viaServers: string[]) => string;
};

/**
 * The sub-rooms under `parent`, indented: the joined ones the section nests there, each with its
 * own sub-rooms, then the rooms `parent` lists that the user has not joined, to join from their
 * preview. The user's own state of a room they have not joined cannot show whether that room
 * names `parent` back, so the listing alone shows it here.
 */
export function SubRoomRows({ parent, tree, renderRoom, previewPath }: SubRoomRowsProps) {
  const client = useMatrixClient();
  const listed = useStateEvents(parent, StateEvent.SpaceChild);
  const joined = (tree.children.get(parent.roomId) ?? []).flatMap(
    (roomId) => client.getRoom(roomId) ?? []
  );
  const toJoin = listed.flatMap((event) => {
    const roomId = event.getStateKey() ?? '';
    const viaServers = viaOf(event.getContent());
    const room = client.getRoom(roomId);
    const known = room?.getMyMembership() === KnownMembership.Join || room?.isSpaceRoom();
    return isRoomId(roomId) && viaServers.length > 0 && !known ? [{ roomId, viaServers }] : [];
  });
  if (joined.length === 0 && toJoin.length === 0) return null;

  return (
    <div data-sub-rooms-of={parent.roomId} style={{ paddingInlineStart: config.space.S400 }}>
      {joined.map((room) => (
        <Fragment key={room.roomId}>
          {renderRoom(room)}
          <SubRoomRows
            parent={room}
            tree={tree}
            renderRoom={renderRoom}
            previewPath={previewPath}
          />
        </Fragment>
      ))}
      {toJoin.map(({ roomId, viaServers }) => (
        <RoomToJoinRow
          key={roomId}
          roomId={roomId}
          viaServers={viaServers}
          to={previewPath(roomId, viaServers)}
        />
      ))}
    </div>
  );
}
