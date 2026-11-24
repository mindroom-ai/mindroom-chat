import type { MatrixClient } from 'matrix-js-sdk';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import { getJoinedSubspaces, getSpaceOwnRooms } from '../../matrix/state/useSpaceSearchRooms';
import type { RoomToParents, RoomToUnread } from '../../matrix/types/room';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';

export type SpaceRoomSection = {
  /** The space whose rooms this section lists (`rootSpaceId` for the top Rooms section). */
  spaceId: string;
  /** `true` for the active space's own Rooms section, `false` for a descendant sub-space. */
  isRoot: boolean;
  /** Immediate parent space ID from the first DFS visit (`undefined` for the root Rooms section). */
  parentSpaceId: string | undefined;
  /** `true` when this section's chat-room scope has no visible rooms (independent of collapse). */
  isEmpty: boolean;
  /** Nav category ID for collapse persistence. */
  categoryId: string;
  /** Visible direct rooms of this space, sorted A to Z. */
  ownRoomsByName: string[];
  /**
   * Visible rooms belonging to this section's chat-room scope (direct rooms plus their chat
   * sub-room descendants, including orphaned sub-rooms of archived direct rooms), sorted A to Z.
   */
  scopeRoomsByName: string[];
};

type DescendantSubspaceEntry = {
  spaceId: string;
  parentSpaceId: string;
};

/**
 * Joined descendant sub-spaces of `rootSpaceId` in pre-order DFS along with the immediate parent
 * space ID of each first visit, ordering sibling sub-spaces A to Z by name at each level.
 * `visited` starts with `rootSpaceId` so cycles terminate and diamond-shared sub-spaces appear
 * once at their first occurrence.
 */
const getDescendantSubspaceEntries = (
  mx: MatrixClient,
  rootSpaceId: string,
  joinedRoomIds: string[],
  roomToParents: RoomToParents
): DescendantSubspaceEntry[] => {
  const visited = new Set<string>([rootSpaceId]);
  const result: DescendantSubspaceEntry[] = [];
  const walk = (parentSpaceId: string) => {
    const children = sortRoomIdsByName(
      mx,
      getJoinedSubspaces(mx, parentSpaceId, joinedRoomIds, roomToParents)
    );
    children.forEach((childId) => {
      if (visited.has(childId)) return;
      visited.add(childId);
      result.push({ spaceId: childId, parentSpaceId });
      walk(childId);
    });
  };
  walk(rootSpaceId);
  return result;
};

/**
 * Joined descendant sub-spaces of `rootSpaceId` in pre-order DFS, ordering sibling sub-spaces
 * A to Z by name at each level. `visited` starts with `rootSpaceId` so cycles terminate and
 * diamond-shared sub-spaces appear once at their first occurrence.
 */
export const getDescendantSubspaces = (
  mx: MatrixClient,
  rootSpaceId: string,
  joinedRoomIds: string[],
  roomToParents: RoomToParents
): string[] =>
  getDescendantSubspaceEntries(mx, rootSpaceId, joinedRoomIds, roomToParents).map(
    (entry) => entry.spaceId
  );

/**
 * Whether `roomId` belongs directly to `sectionSpaceId` or reaches it solely through chat-room
 * parents (never crossing through another Space).
 */
const belongsToSpaceSection = (
  roomId: string,
  sectionSpaceId: string,
  roomToParents: RoomToParents,
  spaceRoomSet: ReadonlySet<string>,
  chatRooms: ReadonlySet<string>
): boolean => {
  const visited = new Set<string>([roomId]);
  const queue = [roomId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    const parents = roomToParents.get(current);
    if (!parents) continue;
    if (parents.has(sectionSpaceId)) return true;
    parents.forEach((parentId) => {
      if (visited.has(parentId)) return;
      if (!spaceRoomSet.has(parentId) && !chatRooms.has(parentId)) return;
      visited.add(parentId);
      queue.push(parentId);
    });
  }
  return false;
};

/**
 * Flat ordered room sections for a Space sidebar: the active space's Rooms section first, followed
 * by joined descendant sub-spaces in pre-order DFS. Empty sub-spaces are kept only when
 * `canEditSpace` allows adding rooms to them (non-editable empty organizers are skipped without
 * hiding their populated descendants); an empty root Rooms section is kept when no sub-space
 * sections are shown or when `canEditSpace(rootSpaceId)` is true.
 */
export const getSpaceRoomSections = (
  mx: MatrixClient,
  rootSpaceId: string,
  joinedRoomIds: string[],
  visibleRoomIds: string[],
  spaceRoomsByName: string[],
  directs: Set<string>,
  roomToParents: RoomToParents,
  chatRooms: ReadonlySet<string>,
  canEditSpace: (spaceId: string) => boolean = () => false
): SpaceRoomSection[] => {
  const spaceRoomSet = new Set(spaceRoomsByName);
  const buildSection = (
    sectionSpaceId: string,
    isRoot: boolean,
    parentSpaceId: string | undefined
  ): SpaceRoomSection => {
    const ownRoomsByName = sortRoomIdsByName(
      mx,
      getSpaceOwnRooms(mx, sectionSpaceId, visibleRoomIds, directs, roomToParents)
    );
    const scopeRoomsByName = spaceRoomsByName.filter((roomId) =>
      belongsToSpaceSection(roomId, sectionSpaceId, roomToParents, spaceRoomSet, chatRooms)
    );
    return {
      spaceId: sectionSpaceId,
      isRoot,
      parentSpaceId,
      isEmpty: scopeRoomsByName.length === 0,
      categoryId: isRoot
        ? makeNavCategoryId(rootSpaceId, 'room')
        : makeNavCategoryId(rootSpaceId, 'subspace', sectionSpaceId),
      ownRoomsByName,
      scopeRoomsByName,
    };
  };

  const subspaceSections = getDescendantSubspaceEntries(
    mx,
    rootSpaceId,
    joinedRoomIds,
    roomToParents
  )
    .map(({ spaceId, parentSpaceId }) => buildSection(spaceId, false, parentSpaceId))
    .filter((section) => !section.isEmpty || canEditSpace(section.spaceId));

  const rootSection = buildSection(rootSpaceId, true, undefined);
  if (rootSection.isEmpty && subspaceSections.length > 0 && !canEditSpace(rootSpaceId)) {
    return subspaceSections;
  }
  return [rootSection, ...subspaceSections];
};

export type CollapsedSectionUnread = { readonly highlight: boolean };

const COLLAPSED_UNREAD: CollapsedSectionUnread = { highlight: false };
const COLLAPSED_HIGHLIGHT: CollapsedSectionUnread = { highlight: true };

/**
 * Whether a collapsed section hides any unread visible room (excluding the lone visible selected
 * room, if shown), and whether any hidden unread room has a highlight/mention. Returns stable
 * singletons so Jotai derived atoms avoid spurious re-renders when unread state is unchanged.
 */
export const getCollapsedSectionUnread = (
  closed: boolean,
  shownRoomIds: readonly string[],
  selectedRoomId: string | undefined,
  unreads: RoomToUnread
): CollapsedSectionUnread | undefined => {
  if (!closed) return undefined;
  let hasUnread = false;
  let highlight = false;
  shownRoomIds.forEach((roomId) => {
    if (roomId === selectedRoomId) return;
    const unread = unreads.get(roomId);
    if (!unread) return;
    hasUnread = true;
    if (unread.highlight > 0) highlight = true;
  });
  if (!hasUnread) return undefined;
  return highlight ? COLLAPSED_HIGHLIGHT : COLLAPSED_UNREAD;
};

/**
 * Deduplicated room IDs across rendered sections for keyboard room-stepping, preserving first
 * occurrence in rendered order (each collapsed section contributes only its lone visible room).
 */
export const collectShortcutRoomIds = (
  sections: readonly {
    closed: boolean;
    listedRoomIds: readonly string[];
    shownRoomIds: readonly string[];
  }[]
): string[] =>
  Array.from(
    new Set(
      sections.flatMap((section) => (section.closed ? section.listedRoomIds : section.shownRoomIds))
    )
  );
