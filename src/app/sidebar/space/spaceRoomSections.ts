import type { MatrixClient } from 'matrix-js-sdk';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import { isSpace } from '../../matrix/room';
import { reachesSpaceDirectly } from '../../matrix/state/spaceAncestors';
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
  /** Ancestor space IDs from nearest parent up to `rootSpaceId`, computed before empty organizers are filtered. */
  ancestorSpaceIds: string[];
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
  ancestorSpaceIds: string[];
};

type TreeAttachable = {
  spaceId: string;
  isRoot: boolean;
  ancestorSpaceIds: readonly string[];
};

type AttachedNode<T extends TreeAttachable> = {
  section: T;
  children: AttachedNode<T>[];
};

const attachSpaceSectionNodes = <T extends TreeAttachable>(
  sections: readonly T[]
): AttachedNode<T>[] => {
  const nodes: AttachedNode<T>[] = sections.map((section) => ({ section, children: [] }));
  const nonRootBySpaceId = new Map<string, AttachedNode<T>>();
  nodes.forEach((node) => {
    if (!node.section.isRoot && !nonRootBySpaceId.has(node.section.spaceId)) {
      nonRootBySpaceId.set(node.section.spaceId, node);
    }
  });

  const attachedParent = new Map<AttachedNode<T>, AttachedNode<T>>();
  const wouldCreateCycle = (node: AttachedNode<T>, candidate: AttachedNode<T>): boolean => {
    let current: AttachedNode<T> | undefined = candidate;
    while (current) {
      if (current === node) return true;
      current = attachedParent.get(current);
    }
    return false;
  };

  const roots: AttachedNode<T>[] = [];
  nodes.forEach((node) => {
    let parent: AttachedNode<T> | undefined;
    if (!node.section.isRoot) {
      for (const ancestorId of node.section.ancestorSpaceIds) {
        const candidate = nonRootBySpaceId.get(ancestorId);
        if (candidate && !wouldCreateCycle(node, candidate)) {
          parent = candidate;
          break;
        }
      }
    }
    if (parent) {
      attachedParent.set(node, parent);
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

export type SpaceSectionTreeInput = {
  spaceId: string;
  isRoot: boolean;
  ancestorSpaceIds: readonly string[];
  closed: boolean;
  listedRoomIds: readonly string[];
  shownRoomIds: readonly string[];
};

export type SpaceSectionTreeNode<T extends SpaceSectionTreeInput> = {
  section: T;
  children: SpaceSectionTreeNode<T>[];
  subtreeShownRoomIds: string[];
};

/**
 * Arranges flat rendered space sections into a cycle-safe forest: each non-root section attaches
 * under its nearest present non-root ancestor, and each node carries the deduplicated ordered
 * union of visible rooms across its subtree.
 */
export const buildSpaceSectionTree = <T extends SpaceSectionTreeInput>(
  sections: readonly T[]
): SpaceSectionTreeNode<T>[] => {
  const hydrate = (node: AttachedNode<T>): SpaceSectionTreeNode<T> => {
    const children = node.children.map(hydrate);
    const seen = new Set<string>(node.section.shownRoomIds);
    children.forEach((child) => {
      child.subtreeShownRoomIds.forEach((roomId) => seen.add(roomId));
    });
    return {
      section: node.section,
      children,
      subtreeShownRoomIds: Array.from(seen),
    };
  };
  return attachSpaceSectionNodes(sections).map(hydrate);
};

/**
 * Joined descendant sub-spaces of `rootSpaceId` in pre-order DFS along with each first visit's
 * immediate parent and full ancestor chain (nearest parent to `rootSpaceId`), ordering sibling
 * sub-spaces A to Z by name at each level. `visited` starts with `rootSpaceId` so cycles
 * terminate and diamond-shared sub-spaces appear once at their first occurrence.
 */
const getDescendantSubspaceEntries = (
  mx: MatrixClient,
  rootSpaceId: string,
  joinedRoomIds: string[],
  roomToParents: RoomToParents
): DescendantSubspaceEntry[] => {
  const visited = new Set<string>([rootSpaceId]);
  const result: DescendantSubspaceEntry[] = [];
  const walk = (parentSpaceId: string, ancestors: readonly string[]) => {
    const nextAncestors = [parentSpaceId, ...ancestors];
    const children = sortRoomIdsByName(
      mx,
      getJoinedSubspaces(mx, parentSpaceId, joinedRoomIds, roomToParents)
    );
    children.forEach((childId) => {
      if (visited.has(childId)) return;
      visited.add(childId);
      result.push({ spaceId: childId, parentSpaceId, ancestorSpaceIds: nextAncestors });
      walk(childId, nextAncestors);
    });
  };
  walk(rootSpaceId, []);
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
): boolean =>
  reachesSpaceDirectly(
    roomId,
    roomToParents,
    (parentId) => parentId === sectionSpaceId,
    (parentId) => spaceRoomSet.has(parentId) || chatRooms.has(parentId)
  );

const createSectionBuilder = (
  mx: MatrixClient,
  visibleRoomIds: string[],
  roomsByName: string[],
  directs: Set<string>,
  roomToParents: RoomToParents,
  chatRooms: ReadonlySet<string>
) => {
  const roomSet = new Set(roomsByName);
  return (
    spaceId: string,
    isRoot: boolean,
    parentSpaceId: string | undefined,
    ancestorSpaceIds: string[],
    categoryId: string
  ): SpaceRoomSection => {
    const ownRoomsByName = sortRoomIdsByName(
      mx,
      getSpaceOwnRooms(mx, spaceId, visibleRoomIds, directs, roomToParents)
    );
    const scopeRoomsByName = roomsByName.filter((roomId) =>
      belongsToSpaceSection(roomId, spaceId, roomToParents, roomSet, chatRooms)
    );
    return {
      spaceId,
      isRoot,
      parentSpaceId,
      ancestorSpaceIds,
      isEmpty: scopeRoomsByName.length === 0,
      categoryId,
      ownRoomsByName,
      scopeRoomsByName,
    };
  };
};

const omitRooms = (section: SpaceRoomSection, excluded: ReadonlySet<string>): SpaceRoomSection => {
  if (excluded.size === 0) return section;
  const scopeRoomsByName = section.scopeRoomsByName.filter((id) => !excluded.has(id));
  return {
    ...section,
    isEmpty: scopeRoomsByName.length === 0,
    ownRoomsByName: section.ownRoomsByName.filter((id) => !excluded.has(id)),
    scopeRoomsByName,
  };
};

/**
 * Single joined ancestor chain upward via `roomToParents` (cycle-safe, nearest joined parent
 * first). Picks the first joined parent sorted A to Z at each step so standalone emitted spaces
 * resolve a single deterministic branch.
 */
const getJoinedAncestorSpaceIds = (
  mx: MatrixClient,
  spaceId: string,
  joinedSpaceSet: ReadonlySet<string>,
  roomToParents: RoomToParents
): string[] => {
  const ancestors: string[] = [];
  const seen = new Set<string>([spaceId]);
  let current = spaceId;
  for (;;) {
    const direct = sortRoomIdsByName(
      mx,
      [...(roomToParents.get(current) ?? [])].filter(
        (parentId) => joinedSpaceSet.has(parentId) && !seen.has(parentId)
      )
    );
    const next = direct[0];
    if (!next) break;
    seen.add(next);
    ancestors.push(next);
    current = next;
  }
  return ancestors;
};

/**
 * Flat ordered room sections for a Space sidebar: the active space's Rooms section first, followed
 * by joined descendant sub-spaces in pre-order DFS. A room listed in a sub-space is left out of
 * every space above it, so a room in both the space and its sub-space shows once. Empty sub-spaces
 * are kept only when `canEditSpace` allows adding rooms to them (non-editable empty organizers are
 * skipped without hiding their populated descendants); an empty root Rooms section is kept when no
 * sub-space sections are shown or when `canEditSpace(rootSpaceId)` is true.
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
  const build = createSectionBuilder(
    mx,
    visibleRoomIds,
    spaceRoomsByName,
    directs,
    roomToParents,
    chatRooms
  );
  const builtRoot = build(rootSpaceId, true, undefined, [], makeNavCategoryId(rootSpaceId, 'room'));
  const builtSubspaces = getDescendantSubspaceEntries(
    mx,
    rootSpaceId,
    joinedRoomIds,
    roomToParents
  ).map(({ spaceId, parentSpaceId, ancestorSpaceIds }) =>
    build(
      spaceId,
      false,
      parentSpaceId,
      ancestorSpaceIds,
      makeNavCategoryId(rootSpaceId, 'subspace', spaceId)
    )
  );
  // A room that a sub-space lists shows there only, not again in the spaces above it.
  const dedupe = (section: SpaceRoomSection): SpaceRoomSection =>
    omitRooms(
      section,
      new Set(
        builtSubspaces
          .filter((other) => other.ancestorSpaceIds.includes(section.spaceId))
          .flatMap((other) => other.scopeRoomsByName)
      )
    );
  const rootSection = dedupe(builtRoot);
  const subspaceSections = builtSubspaces
    .map(dedupe)
    .filter((section) => !section.isEmpty || canEditSpace(section.spaceId));

  if (rootSection.isEmpty && subspaceSections.length > 0 && !canEditSpace(rootSpaceId)) {
    return subspaceSections;
  }
  return [rootSection, ...subspaceSections];
};

export type HomeSpaceSections = {
  /** Visible ordinary rooms outside every joined space, sorted A to Z. */
  unspacedByName: string[];
  /** Ordered joined space sections for Home (rail order + DFS sub-spaces + remaining sweep). */
  sections: SpaceRoomSection[];
};

/**
 * Splits Home's visible ordinary rooms into unspaced rooms and ordered space sections:
 * spaces follow `railSpaceIds` with each space's joined descendants immediately below in pre-order
 * DFS, then any remaining joined spaces (e.g. mutual cycles or sub-spaces whose parent was left).
 * Rooms listed in any Matrix descendant sub-space are omitted from ancestor spaces regardless of
 * rail pin order. Read-only spaces with 0 direct rooms are kept when they have at least one kept
 * descendant section so parent containers stay collapsible in Home's nested tree.
 */
export const getHomeSpaceSections = (
  mx: MatrixClient,
  railSpaceIds: readonly string[],
  joinedRoomIds: string[],
  visibleRoomIds: string[],
  homeRoomsByName: string[],
  directs: Set<string>,
  roomToParents: RoomToParents,
  chatRooms: ReadonlySet<string>,
  canEditSpace: (spaceId: string) => boolean = () => false
): HomeSpaceSections => {
  const joinedSpaceIds = joinedRoomIds.filter((roomId) => isSpace(mx.getRoom(roomId)));
  const joinedSpaceSet = new Set(joinedSpaceIds);
  const build = createSectionBuilder(
    mx,
    visibleRoomIds,
    homeRoomsByName,
    directs,
    roomToParents,
    chatRooms
  );

  const emitted = new Set<string>();
  const built: SpaceRoomSection[] = [];
  const emit = (spaceId: string, ancestorChain?: readonly string[]): string[] | undefined => {
    if (emitted.has(spaceId) || !joinedSpaceSet.has(spaceId)) return undefined;
    emitted.add(spaceId);
    const ancestors = ancestorChain
      ? [...new Set(ancestorChain)].filter((id) => id !== spaceId)
      : getJoinedAncestorSpaceIds(mx, spaceId, joinedSpaceSet, roomToParents);
    built.push(
      build(spaceId, false, ancestors[0], ancestors, makeNavCategoryId('home', 'space', spaceId))
    );
    return ancestors;
  };
  const emitTree = (rootSpaceId: string) => {
    const rootAncestors = emit(rootSpaceId);
    if (!rootAncestors) return;
    getDescendantSubspaceEntries(mx, rootSpaceId, joinedRoomIds, roomToParents).forEach(
      ({ spaceId, ancestorSpaceIds }) => emit(spaceId, [...ancestorSpaceIds, ...rootAncestors])
    );
  };

  railSpaceIds.forEach(emitTree);
  const remaining = sortRoomIdsByName(
    mx,
    joinedSpaceIds.filter((id) => !emitted.has(id))
  );
  const remainingRoots = remaining.filter(
    (id) => ![...(roomToParents.get(id) ?? [])].some((parentId) => joinedSpaceSet.has(parentId))
  );
  [...remainingRoots, ...remaining].forEach(emitTree);

  const covered = new Set(built.flatMap((section) => section.scopeRoomsByName));
  const unspacedByName = homeRoomsByName.filter((roomId) => !covered.has(roomId));
  const descendantsOf = new Map(
    built.map((section) => [
      section.spaceId,
      new Set(getDescendantSubspaces(mx, section.spaceId, joinedRoomIds, roomToParents)),
    ])
  );
  const bySpace = new Map(built.map((section, index) => [section.spaceId, { section, index }]));

  const deduped = built.map((section, index) => {
    const listedBelow = new Set<string>();
    descendantsOf.get(section.spaceId)?.forEach((descendantId) => {
      const entry = bySpace.get(descendantId);
      if (!entry) return;
      const mutualCycle = descendantsOf.get(descendantId)?.has(section.spaceId) ?? false;
      if (mutualCycle && entry.index < index) return;
      entry.section.scopeRoomsByName.forEach((roomId) => listedBelow.add(roomId));
    });
    return omitRooms(section, listedBelow);
  });

  // Post-order prune on the display tree: keep empty read-only containers only when they have a
  // kept descendant section, dropping truly empty read-only branches.
  const keptSpaceIds = new Set<string>();
  const prune = (node: AttachedNode<SpaceRoomSection>): boolean => {
    let hasKeptDescendant = false;
    node.children.forEach((child) => {
      if (prune(child)) hasKeptDescendant = true;
    });
    const keep = !node.section.isEmpty || canEditSpace(node.section.spaceId) || hasKeptDescendant;
    if (keep) keptSpaceIds.add(node.section.spaceId);
    return keep;
  };
  attachSpaceSectionNodes(deduped).forEach(prune);
  const sections = deduped.filter((section) => keptSpaceIds.has(section.spaceId));

  return { unspacedByName, sections };
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

export type ShortcutRoomSection = {
  closed: boolean;
  listedRoomIds: readonly string[];
  shownRoomIds: readonly string[];
};

export type ShortcutRoomEntry =
  | ShortcutRoomSection
  | {
      section: ShortcutRoomSection;
      children: readonly ShortcutRoomEntry[];
      subtreeShownRoomIds?: readonly string[];
    };

const isShortcutTreeEntry = (
  entry: ShortcutRoomEntry
): entry is {
  section: ShortcutRoomSection;
  children: readonly ShortcutRoomEntry[];
  subtreeShownRoomIds?: readonly string[];
} => 'section' in entry;

/**
 * Deduplicated room IDs across rendered sections or tree nodes for keyboard room-stepping,
 * preserving first occurrence in rendered order and skipping rooms hidden under any collapsed
 * ancestor (while still including the lone visible selected room, if shown).
 */
export const collectShortcutRoomIds = (
  entries: readonly ShortcutRoomEntry[],
  selectedRoomId?: string
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (roomId: string) => {
    if (seen.has(roomId)) return;
    seen.add(roomId);
    result.push(roomId);
  };
  const visit = (entry: ShortcutRoomEntry, ancestorClosed: boolean) => {
    const section = isShortcutTreeEntry(entry) ? entry.section : entry;
    const closed = section.closed || ancestorClosed;
    const rooms = closed
      ? selectedRoomId !== undefined
        ? section.shownRoomIds.filter((id) => id === selectedRoomId)
        : section.closed
          ? section.listedRoomIds
          : []
      : section.shownRoomIds;
    rooms.forEach(push);
    if (!isShortcutTreeEntry(entry)) return;
    if (!closed) {
      entry.children.forEach((child) => visit(child, false));
    } else if (selectedRoomId !== undefined) {
      entry.children.forEach((child) => {
        if (
          !isShortcutTreeEntry(child) ||
          !child.subtreeShownRoomIds ||
          child.subtreeShownRoomIds.includes(selectedRoomId)
        ) {
          visit(child, true);
        }
      });
    }
  };
  entries.forEach((entry) => visit(entry, false));
  return result;
};
