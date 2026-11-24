import { useCallback } from 'react';
import { KnownMembership, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { matchesEnum } from '../../lib/matchesEnum';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { type RoomToParents, StateEvent } from '../../matrix/types/room';
import { canSendState } from '../../spaces/lobby/spaceChildren';
import { type ActivityTrackedSection, orderRoomsForMode } from '../room-nav/roomActivity';
import type { RoomOrders, RoomSortMode } from '../room-nav/roomOrder';
import { type SubRoomTree, buildSubRoomList } from '../room-nav/SubRoomRows';
import type { SpaceRoomSection as SpaceRoomSectionData } from './spaceRoomSections';
import type { SubspaceSortOptions } from './SpaceSectionHeader';

export type RenderedSpaceRoomSection = SpaceRoomSectionData & {
  closed: boolean;
  tree: SubRoomTree;
  orderedTop: string[];
  shownRoomIds: string[];
  listedRoomIds: string[];
  mode: RoomSortMode;
  showTimes: boolean;
  inheritFrom: readonly string[] | undefined;
  sort?: SubspaceSortOptions;
};

const inheritsFromSpace = (
  section: Pick<RenderedSpaceRoomSection, 'spaceId' | 'inheritFrom'>,
  targetSpaceId: string,
  hasExplicitMode: (listId: string) => boolean
): boolean => {
  if (section.spaceId === targetSpaceId || hasExplicitMode(section.spaceId)) return false;
  const targetIndex = section.inheritFrom?.indexOf(targetSpaceId) ?? -1;
  if (targetIndex < 0) return false;
  return section
    .inheritFrom!.slice(0, targetIndex)
    .every((ancestorId) => !hasExplicitMode(ancestorId));
};

/** Snapshots current room orders of sub-spaces inheriting sort mode from `targetSpaceId`. */
export const collectInheritedOrders = (
  sections: readonly Pick<RenderedSpaceRoomSection, 'spaceId' | 'inheritFrom' | 'orderedTop'>[],
  targetSpaceId: string,
  hasExplicitMode: (listId: string) => boolean
): Record<string, readonly string[]> | undefined => {
  const inherited: Record<string, readonly string[]> = {};
  sections.forEach((section) => {
    if (
      section.orderedTop.length > 0 &&
      inheritsFromSpace(section, targetSpaceId, hasExplicitMode)
    ) {
      inherited[section.spaceId] = section.orderedTop;
    }
  });
  return Object.keys(inherited).length > 0 ? inherited : undefined;
};

/** Builds an `ActivityTrackedSection` descriptor for `useRoomActivityListener`. */
export const toActivityTrackedSection = (section: {
  mode: RoomSortMode;
  showTimes: boolean;
  tree: SubRoomTree;
  orderedTop: string[];
  shownRoomIds: string[];
}): ActivityTrackedSection => ({
  recent: section.mode === 'recent',
  showTimes: section.showTimes,
  baseTop: section.tree.top,
  orderedTop: section.orderedTop,
  tree: section.tree,
  trackedRoomIds: new Set(section.shownRoomIds),
});

/** Reactive `m.space.child` edit permission check across `trackedSpaceIds`. */
export function useSpaceEditPermissions(
  trackedSpaceIds: ReadonlySet<string>,
  joinedRoomSet: ReadonlySet<string>
): (targetSpaceId: string) => boolean {
  const client = useMatrixClient();
  const [powerLevelsVersion, refreshPowerLevels] = useForceUpdate();
  const handlePowerLevelsChange = useCallback(
    (event: MatrixEvent) => {
      if (
        matchesEnum(event.getType(), StateEvent.RoomPowerLevels) &&
        trackedSpaceIds.has(event.getRoomId() ?? '')
      ) {
        refreshPowerLevels();
      }
    },
    [trackedSpaceIds, refreshPowerLevels]
  );
  useStateEventCallback(client, handlePowerLevelsChange);

  return useCallback(
    (targetSpaceId: string): boolean => {
      void powerLevelsVersion;
      if (!joinedRoomSet.has(targetSpaceId)) return false;
      const room = client.getRoom(targetSpaceId);
      return (
        room !== null &&
        matchesEnum(room.getMyMembership(), KnownMembership.Join) &&
        canSendState(client, room, StateEvent.SpaceChild)
      );
    },
    [client, joinedRoomSet, powerLevelsVersion]
  );
}

export type BuildRenderedSpaceSectionsOptions = {
  client: MatrixClient;
  rawSections: readonly SpaceRoomSectionData[];
  rootAncestors?: readonly string[];
  closedCategories: ReadonlySet<string>;
  roomToParents: RoomToParents;
  chatRooms: ReadonlySet<string>;
  roomOrders: RoomOrders;
  selectedRoomId: string | undefined;
  sectionsRef: { current: readonly RenderedSpaceRoomSection[] };
};

/** Hydrates raw space sections with collapse state, sub-room trees, sort modes, and menu controls. */
export const buildRenderedSpaceSections = ({
  client,
  rawSections,
  rootAncestors = [],
  closedCategories,
  roomToParents,
  chatRooms,
  roomOrders,
  selectedRoomId,
  sectionsRef,
}: BuildRenderedSpaceSectionsOptions): RenderedSpaceRoomSection[] =>
  rawSections.map((section) => {
    const closed = closedCategories.has(section.categoryId);
    const chain = [...new Set([...section.ancestorSpaceIds, ...rootAncestors])].filter(
      (id) => id !== section.spaceId
    );
    const inheritFrom = chain.length > 0 ? chain : undefined;
    const mode = roomOrders.modeOf(section.spaceId, inheritFrom);
    const showTimes = roomOrders.showTimesOf(section.spaceId, inheritFrom);
    const list = buildSubRoomList(
      section.ownRoomsByName,
      section.scopeRoomsByName,
      roomToParents,
      chatRooms,
      (top, tree) =>
        orderRoomsForMode(
          client,
          mode,
          top,
          (ids) => roomOrders.orderOf(section.spaceId, ids),
          tree
        ),
      closed,
      selectedRoomId
    );
    const sort: SubspaceSortOptions | undefined = section.isRoot
      ? undefined
      : {
          mode,
          inherit: inheritFrom
            ? {
                mode: roomOrders.modeOf(inheritFrom[0]!, inheritFrom.slice(1)),
                overridden: roomOrders.hasExplicitMode(section.spaceId),
                onReset: () => roomOrders.resetSubspaceOverride(section.spaceId),
              }
            : undefined,
          showTimes,
          hasSavedOrder: roomOrders.hasSavedOrder(section.spaceId),
          onModeChange: (nextMode) =>
            roomOrders.setMode(
              section.spaceId,
              nextMode,
              list.orderedTop,
              nextMode === 'manual'
                ? collectInheritedOrders(
                    sectionsRef.current,
                    section.spaceId,
                    roomOrders.hasExplicitMode
                  )
                : undefined
            ),
          onShowTimesChange: (show) => roomOrders.setShowTimes(section.spaceId, show, inheritFrom),
        };
    return { ...section, closed, ...list, mode, showTimes, inheritFrom, sort };
  });
