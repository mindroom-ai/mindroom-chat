import { useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { chatRoomParentsAtom, roomToParentsAtom } from '../../matrix/state/roomToParents';
import { isOrdinaryRoom } from '../../matrix/state/useHomeRooms';
import { useShownSidebarItems } from '../../spaces/sidebarSpaces';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { orderRoomsForMode, useRoomActivityListener } from '../room-nav/roomActivity';
import {
  HOME_ROOM_LIST,
  type RoomOrder,
  type RoomSortMode,
  useRoomOrders,
} from '../room-nav/roomOrder';
import { buildSubRoomList } from '../room-nav/SubRoomRows';
import {
  type RenderedSpaceRoomSection,
  buildRenderedSpaceSections,
  toActivityTrackedSection,
  useSpaceEditPermissions,
} from '../space/spaceSectionHelpers';
import { getHomeSpaceSections } from '../../spaces/spaceRoomSections';
import { buildSpaceSectionTree, collectShortcutRoomIds } from '../../spaces/spaceSectionTree';

/**
 * Derives Home's unspaced Rooms list and rail-ordered Space sections from one `useRoomOrders`
 * subscription and one `useRoomActivityListener`.
 */
export function useHomeRoomSections(selectedRoomId: string | undefined) {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const visibleRoomIds = useVisibleRooms(joinedRoomIds);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const chatRooms = useAtomValue(chatRoomParentsAtom);
  const { items: sidebarItems, joinedSpaces } = useShownSidebarItems();

  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const onCategoryClick = useCategoryHandler(setClosedCategories, (id) => closedCategories.has(id));

  const joinedRoomSet = useMemo(() => new Set(joinedRoomIds), [joinedRoomIds]);
  const joinedSpaceSet = useMemo(() => new Set(joinedSpaces.keys()), [joinedSpaces]);
  const canEditSpace = useSpaceEditPermissions(joinedSpaceSet, joinedRoomSet);

  const railSpaceIds = useMemo(
    () => sidebarItems.flatMap((item) => (typeof item === 'string' ? [item] : item.content)),
    [sidebarItems]
  );

  const allVisibleHomeRooms = useMemo(
    () =>
      sortRoomIdsByName(
        client,
        visibleRoomIds.filter((roomId) => isOrdinaryRoom(client, roomId, directRoomIds))
      ),
    [client, visibleRoomIds, directRoomIds]
  );

  const { unspacedByName, sections: rawSections } = useMemo(
    () =>
      getHomeSpaceSections(
        client,
        railSpaceIds,
        joinedRoomIds,
        visibleRoomIds,
        allVisibleHomeRooms,
        directRoomIds,
        roomToParents,
        chatRooms,
        canEditSpace
      ),
    [
      client,
      railSpaceIds,
      joinedRoomIds,
      visibleRoomIds,
      allVisibleHomeRooms,
      directRoomIds,
      roomToParents,
      chatRooms,
      canEditSpace,
    ]
  );

  const roomOrders = useRoomOrders();
  const [activityVersion, bumpActivity] = useReducer((count: number) => count + 1, 0);

  const roomsCategoryId = makeNavCategoryId('home', 'room');
  const roomsClosed = closedCategories.has(roomsCategoryId);
  const unspacedMode = roomOrders.modeOf(HOME_ROOM_LIST);
  const unspacedShowTimes = roomOrders.showTimesOf(HOME_ROOM_LIST);

  const unspacedList = useMemo(() => {
    void activityVersion;
    return buildSubRoomList(
      unspacedByName,
      unspacedByName,
      roomToParents,
      chatRooms,
      (top, tree) =>
        orderRoomsForMode(
          client,
          unspacedMode,
          top,
          (ids) => roomOrders.orderOf(HOME_ROOM_LIST, ids),
          tree
        ),
      roomsClosed,
      selectedRoomId
    );
  }, [
    activityVersion,
    client,
    unspacedByName,
    roomToParents,
    chatRooms,
    unspacedMode,
    roomOrders,
    roomsClosed,
    selectedRoomId,
  ]);

  const roomOrder = useMemo<RoomOrder>(
    () => ({
      mode: unspacedMode,
      showTimes: unspacedShowTimes,
      hasSavedOrder: roomOrders.hasSavedOrder(HOME_ROOM_LIST),
      save: (order: string[]) => roomOrders.save(HOME_ROOM_LIST, order),
      setMode: (nextMode: RoomSortMode) =>
        roomOrders.setMode(HOME_ROOM_LIST, nextMode, unspacedList.orderedTop),
      setShowTimes: (show: boolean) => roomOrders.setShowTimes(HOME_ROOM_LIST, show),
    }),
    [roomOrders, unspacedMode, unspacedShowTimes, unspacedList.orderedTop]
  );

  const sectionsRef = useRef<RenderedSpaceRoomSection[]>([]);
  const sections = useMemo<RenderedSpaceRoomSection[]>(() => {
    void activityVersion;
    return buildRenderedSpaceSections({
      client,
      rawSections,
      closedCategories,
      roomToParents,
      chatRooms,
      roomOrders,
      selectedRoomId,
      sectionsRef,
    });
  }, [
    activityVersion,
    client,
    rawSections,
    closedCategories,
    roomToParents,
    chatRooms,
    roomOrders,
    selectedRoomId,
  ]);
  sectionsRef.current = sections;

  const sectionTree = useMemo(() => buildSpaceSectionTree(sections), [sections]);

  const spaceCategoryIds = useMemo(
    () => rawSections.map((section) => section.categoryId),
    [rawSections]
  );
  const shouldDefaultCloseSpaces = unspacedByName.length > 0 || sectionTree.length > 1;
  useLayoutEffect(() => {
    if (!shouldDefaultCloseSpaces || spaceCategoryIds.length === 0) return;
    setClosedCategories({ type: 'INIT_CLOSED', categoryIds: spaceCategoryIds });
  }, [shouldDefaultCloseSpaces, spaceCategoryIds, setClosedCategories]);

  const trackedSections = useMemo(
    () => [
      toActivityTrackedSection({
        mode: unspacedMode,
        showTimes: unspacedShowTimes,
        ...unspacedList,
      }),
      ...sections.map(toActivityTrackedSection),
    ],
    [unspacedMode, unspacedShowTimes, unspacedList, sections]
  );
  useRoomActivityListener(trackedSections, bumpActivity);

  const shortcutRoomIds = useMemo(
    () =>
      collectShortcutRoomIds(
        [
          {
            closed: roomsClosed,
            listedRoomIds: unspacedList.listedRoomIds,
            shownRoomIds: unspacedList.shownRoomIds,
          },
          ...sectionTree,
        ],
        selectedRoomId
      ),
    [
      roomsClosed,
      unspacedList.listedRoomIds,
      unspacedList.shownRoomIds,
      sectionTree,
      selectedRoomId,
    ]
  );

  return {
    allVisibleHomeRooms,
    unspaced: unspacedByName,
    closedCategories,
    roomsCategoryId,
    roomsClosed,
    unspacedShownRoomIds: unspacedList.shownRoomIds,
    tree: unspacedList.tree,
    listedRoomIds: unspacedList.listedRoomIds,
    roomOrder,
    sections,
    sectionTree,
    shortcutRoomIds,
    onCategoryClick,
    onReorder: roomOrders.save,
  };
}
