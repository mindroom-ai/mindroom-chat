import React, { useCallback, useMemo, useState } from 'react';
import { Box, Scroll, config } from 'folds';
import { useNavigate } from 'react-router-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { Page } from '../../components/page';
import { LocalRoomSummaryLoader, RoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import type { LocalRoomSummary } from '../../hooks/useLocalRoomSummary';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { useSpace } from '../../hooks/useSpace';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { getSpacePath, getSpaceRoomPath } from '../../pages/pathUtils';
import { MembersDrawer } from '../room/MembersDrawer';
import { ResizableMembersPanel } from '../../mindroom/sidebar/ResizableMembersPanel';
import { useMembersDrawer } from '../../mindroom/sidebar/useMembersDrawer';
import { LobbyHeader } from './LobbyHeader';
import { RoomItemCard } from './RoomItem';
import { SpaceItemCard } from './SpaceItem';

type CardSummary = (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;

const toCardSummary = (summary: LocalRoomSummary): CardSummary => ({
  room_id: summary.roomId,
  name: summary.name,
  topic: summary.topic,
  avatar_url: summary.avatarUrl,
  canonical_alias: summary.canonicalAlias,
  world_readable: summary.worldReadable,
  guest_can_join: summary.guestCanJoin,
  num_joined_members: summary.memberCount,
  room_type: summary.roomType,
  join_rule: summary.joinRule,
  children_state: [],
});

/** The `m.space.child` entries of a space, ordered by `order`, then by when they were added. */
const getChildItems = (space: Room, depth: number, parentId: string): HierarchyItem[] =>
  space.currentState
    .getStateEvents('m.space.child')
    .flatMap((event): HierarchyItem[] => {
      const roomId = event.getStateKey();
      const content = event.getContent() as HierarchyItem['content'];
      if (!roomId || !Array.isArray(content.via) || content.via.length === 0) return [];
      const base = { roomId, content, ts: event.getTs(), depth };
      const child = space.client.getRoom(roomId);
      const isSpaceChild = child?.isSpaceRoom() ?? false;
      return [isSpaceChild ? { ...base, space: true, parentId } : { ...base, parentId }];
    })
    .sort((a, b) => {
      const orderA = typeof a.content.order === 'string' ? a.content.order : undefined;
      const orderB = typeof b.content.order === 'string' ? b.content.order : undefined;
      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
        return orderA < orderB ? -1 : 1;
      }
      if (orderA !== undefined && orderB === undefined) return -1;
      if (orderA === undefined && orderB !== undefined) return 1;
      return a.ts - b.ts;
    });

/** The space's rooms and subspaces, one level of each joined subspace below it. */
const getLobbyItems = (client: MatrixClient, space: Room): HierarchyItem[] =>
  getChildItems(space, 1, space.roomId).flatMap((item) => {
    if (!item.space) return [item];
    const subspace = client.getRoom(item.roomId);
    return subspace ? [item, ...getChildItems(subspace, 2, item.roomId)] : [item];
  });

const noop = () => undefined;

/** A space's lobby: its header, the rooms and subspaces it lists, and the space's members. */
export function Lobby() {
  const space = useSpace();
  const client = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const powerLevels = usePowerLevels(space);
  const members = useRoomMembers(client, space.roomId);
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const [closedCategories, setClosedCategories] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => getLobbyItems(client, space), [client, space]);
  const getRoom = useCallback((roomId: string) => client.getRoom(roomId) ?? undefined, [client]);

  const toggleCategory = (categoryId: string) =>
    setClosedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  const openRoom = (roomId: string) => navigate(getSpaceRoomPath(space.roomId, roomId));

  const renderRoom = (item: HierarchyItem) => {
    const local = getRoom(item.roomId);
    const card = (summary: CardSummary, loading: boolean, error: Error | null) => (
      <RoomItemCard
        key={item.roomId}
        item={item}
        loading={loading}
        error={error}
        summary={summary}
        onOpen={openRoom}
        onDragging={noop}
        canReorder={false}
        getRoom={getRoom}
      />
    );
    if (local) {
      return (
        <LocalRoomSummaryLoader key={item.roomId} room={local}>
          {(summary) => card(toCardSummary(summary), false, null)}
        </LocalRoomSummaryLoader>
      );
    }
    return (
      <RoomSummaryLoader
        key={item.roomId}
        roomIdOrAlias={item.roomId}
        viaServers={item.content.via}
      >
        {(state) =>
          card(
            state.status === AsyncStatus.Success
              ? (state.data as unknown as CardSummary)
              : undefined,
            state.status === AsyncStatus.Loading || state.status === AsyncStatus.Idle,
            state.status === AsyncStatus.Error ? (state.error as Error) : null
          )
        }
      </RoomSummaryLoader>
    );
  };

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes" style={{ minWidth: 0, minHeight: 0 }}>
        <Page>
          <LobbyHeader
            powerLevels={powerLevels}
            onBack={
              screenSize === ScreenSize.Mobile
                ? () => navigate(getSpacePath(space.roomId))
                : undefined
            }
          />
          <Box grow="Yes" style={{ minHeight: 0 }}>
            <Scroll hideTrack visibility="Hover">
              <Box
                direction="Column"
                gap="200"
                style={{ padding: config.space.S400, maxWidth: '720px', margin: '0 auto' }}
              >
                {items.map((item) => {
                  if (item.space) {
                    const joined = !!getRoom(item.roomId);
                    return (
                      <SpaceItemCard
                        key={item.roomId}
                        item={item}
                        summary={undefined}
                        joined={joined}
                        categoryId={item.roomId}
                        closed={closedCategories.has(item.roomId)}
                        handleClose={toggleCategory}
                        canEditChild={false}
                        canReorder={false}
                        onDragging={noop}
                        getRoom={getRoom}
                      />
                    );
                  }
                  if (item.depth === 2 && closedCategories.has(item.parentId)) return null;
                  return renderRoom(item);
                })}
              </Box>
            </Scroll>
          </Box>
        </Page>
        {membersOpen && (
          <ResizableMembersPanel onClose={() => setMembersOpen(false)}>
            <MembersDrawer key={space.roomId} room={space} members={members} />
          </ResizableMembersPanel>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
