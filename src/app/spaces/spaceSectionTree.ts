export type TreeAttachable = {
  spaceId: string;
  isRoot: boolean;
  ancestorSpaceIds: readonly string[];
};

export type AttachedNode<T extends TreeAttachable> = {
  section: T;
  children: AttachedNode<T>[];
};

/**
 * Attaches each non-root section under its nearest present non-root ancestor in `ancestorSpaceIds`
 * without creating cycles; sections with no valid present ancestor stay top-level forest roots.
 */
export const attachSpaceSectionNodes = <T extends TreeAttachable>(
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

export type SpaceSectionTreeInput = TreeAttachable & {
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
 * Finds the first descendant section in `childNodes` whose own visible room scope contains
 * `selectedRoomId`, so a collapsed parent can keep that active room row visible without rendering
 * nested collapsed sub-space headers.
 */
export const findSelectedDescendantSection = <T extends SpaceSectionTreeInput>(
  childNodes: readonly SpaceSectionTreeNode<T>[],
  selectedRoomId: string | undefined
): T | undefined => {
  if (selectedRoomId === undefined) return undefined;
  for (const child of childNodes) {
    if (!child.subtreeShownRoomIds.includes(selectedRoomId)) continue;
    if (child.section.shownRoomIds.includes(selectedRoomId)) return child.section;
    const deeper = findSelectedDescendantSection(child.children, selectedRoomId);
    if (deeper) return deeper;
  }
  return undefined;
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
 * preserving first occurrence in rendered order and skipping descendants of collapsed sections
 * (while still including the lone visible selected room, if shown).
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
  const visit = (entry: ShortcutRoomEntry) => {
    const section = isShortcutTreeEntry(entry) ? entry.section : entry;
    if (section.closed) {
      section.listedRoomIds.forEach(push);
      if (
        selectedRoomId !== undefined &&
        isShortcutTreeEntry(entry) &&
        entry.subtreeShownRoomIds?.includes(selectedRoomId)
      ) {
        push(selectedRoomId);
      }
      return;
    }
    section.shownRoomIds.forEach(push);
    if (isShortcutTreeEntry(entry)) {
      entry.children.forEach(visit);
    }
  };
  entries.forEach(visit);
  return result;
};
