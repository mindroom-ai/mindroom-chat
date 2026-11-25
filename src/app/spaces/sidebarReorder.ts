import type { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../matrix/types/accountData';

// Sidebar entries are space room IDs or folders of space room IDs, synced
// across devices in the `io.mindroom.spaces` account data.

export type SidebarFolder = {
  id: string;
  name?: string;
  content: string[];
};

export type SidebarItem = string | SidebarFolder;

/** What is dragged or dropped on: a top-level space, a folder, or a space inside a folder. */
export type SidebarDragItem = string | { folder: SidebarFolder; spaceId?: string };

export type SidebarInstructionType = 'reorder-above' | 'reorder-below' | 'make-child';

type SidebarAccountData = {
  sidebar?: SidebarItem[];
  [key: string]: unknown;
};

type CommitSidebarReorderOptions = {
  mx: MatrixClient;
  /** Joined spaces with no parent space that the sidebar lists after its saved items. */
  orphanSpaces: string[];
  /** The order saved in account data (or optimistic pending order). */
  savedItems: SidebarItem[];
  item: SidebarDragItem;
  containerItem: SidebarDragItem;
  instructionType: SidebarInstructionType;
  onEmptyFolder?: (folderId: string) => void;
};

type CommitSidebarReorderResult =
  | { items: SidebarItem[]; changed: false; save?: undefined }
  | { items: SidebarItem[]; changed: true; save: Promise<unknown> };

const isFolder = (item: SidebarItem): item is SidebarFolder => typeof item !== 'string';

const isFolderDrag = (item: SidebarDragItem): item is { folder: SidebarFolder; spaceId?: string } =>
  typeof item !== 'string';

const itemKey = (item: SidebarItem): string => (isFolder(item) ? `folder:${item.id}` : item);

const dragKey = (item: SidebarDragItem): string => {
  if (!isFolderDrag(item)) return item;
  return item.spaceId ? item.spaceId : `folder:${item.folder.id}`;
};

const createFolderId = (): string =>
  `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const sameSidebarItems = (a: SidebarItem[], b: SidebarItem[]): boolean =>
  a.length === b.length &&
  a.every((entry, index) => {
    const other = b[index];
    if (!other || typeof entry === 'string' || typeof other === 'string') return entry === other;
    return (
      entry.id === other.id &&
      entry.name === other.name &&
      entry.content.length === other.content.length &&
      entry.content.every((id, contentIndex) => id === other.content[contentIndex])
    );
  });

/** Adds orphan spaces the saved list does not mention yet, so indexes match what is shown. */
const withOrphans = (items: SidebarItem[], orphanSpaces: string[]): SidebarItem[] => {
  const known = new Set<string>();
  items.forEach((item) => {
    if (isFolder(item)) item.content.forEach((id) => known.add(id));
    else known.add(item);
  });
  return [...items, ...orphanSpaces.filter((id) => !known.has(id))];
};

const insertRelative = <T>(list: T[], value: T, index: number, below: boolean): T[] => {
  const next = [...list];
  const position = index < 0 ? next.length : index + (below ? 1 : 0);
  next.splice(position, 0, value);
  return next;
};

/** Removes the dragged entry and reports a folder it emptied. */
const removeDragged = (
  items: SidebarItem[],
  item: SidebarDragItem
): { items: SidebarItem[]; removed?: SidebarItem; emptiedFolderId?: string } => {
  if (isFolderDrag(item) && item.spaceId) {
    const { spaceId } = item;
    let emptiedFolderId: string | undefined;
    const next: SidebarItem[] = [];
    items.forEach((entry) => {
      if (!isFolder(entry) || entry.id !== item.folder.id) {
        next.push(entry);
        return;
      }
      const content = entry.content.filter((id) => id !== spaceId);
      if (content.length === 0) emptiedFolderId = entry.id;
      else next.push({ ...entry, content });
    });
    return { items: next, removed: spaceId, emptiedFolderId };
  }

  const key = dragKey(item);
  const removed = items.find((entry) => itemKey(entry) === key);
  return { items: items.filter((entry) => itemKey(entry) !== key), removed };
};

const applyReorder = (
  base: SidebarItem[],
  item: SidebarDragItem,
  containerItem: SidebarDragItem,
  instructionType: SidebarInstructionType
): { items: SidebarItem[]; emptiedFolderId?: string } => {
  // Dragging or moving a folder onto itself or one of its own child spaces is a no-op.
  if (
    isFolderDrag(item) &&
    !item.spaceId &&
    isFolderDrag(containerItem) &&
    containerItem.folder.id === item.folder.id
  ) {
    return { items: base };
  }

  // Dropping a space inside a folder as make-child onto its own folder header is a no-op.
  if (
    isFolderDrag(item) &&
    item.spaceId &&
    isFolderDrag(containerItem) &&
    !containerItem.spaceId &&
    item.folder.id === containerItem.folder.id &&
    instructionType === 'make-child'
  ) {
    return { items: base };
  }

  const below = instructionType === 'reorder-below';

  // Reordering inside one folder.
  if (
    isFolderDrag(item) &&
    item.spaceId &&
    isFolderDrag(containerItem) &&
    containerItem.spaceId &&
    containerItem.folder.id === item.folder.id &&
    instructionType !== 'make-child'
  ) {
    const { spaceId } = item;
    const targetId = containerItem.spaceId;
    return {
      items: base.map((entry) => {
        if (!isFolder(entry) || entry.id !== item.folder.id) return entry;
        const content = entry.content.filter((id) => id !== spaceId);
        return {
          ...entry,
          content: insertRelative(content, spaceId, content.indexOf(targetId), below),
        };
      }),
    };
  }

  const { items: withoutItem, removed, emptiedFolderId } = removeDragged(base, item);
  if (removed === undefined) return { items: base };
  const movedSpaceId = typeof removed === 'string' ? removed : undefined;

  if (instructionType === 'make-child' && movedSpaceId) {
    // Into an existing folder, or onto a space to start a new folder with it.
    if (isFolderDrag(containerItem)) {
      const folderId = containerItem.folder.id;
      return {
        emptiedFolderId,
        items: withoutItem.map((entry) =>
          isFolder(entry) && entry.id === folderId
            ? {
                ...entry,
                content: [...entry.content.filter((id) => id !== movedSpaceId), movedSpaceId],
              }
            : entry
        ),
      };
    }
    const targetIndex = withoutItem.findIndex((entry) => entry === containerItem);
    if (targetIndex < 0) return { items: base };
    const next = [...withoutItem];
    next.splice(targetIndex, 1, { id: createFolderId(), content: [containerItem, movedSpaceId] });
    return { items: next, emptiedFolderId };
  }

  // A space moved into a folder next to another space in it.
  if (isFolderDrag(containerItem) && containerItem.spaceId && movedSpaceId) {
    const targetId = containerItem.spaceId;
    return {
      emptiedFolderId,
      items: withoutItem.map((entry) => {
        if (!isFolder(entry) || entry.id !== containerItem.folder.id) return entry;
        return {
          ...entry,
          content: insertRelative(
            entry.content,
            movedSpaceId,
            entry.content.indexOf(targetId),
            below
          ),
        };
      }),
    };
  }

  const targetKey = dragKey(
    isFolderDrag(containerItem) ? { folder: containerItem.folder } : containerItem
  );
  const targetIndex = withoutItem.findIndex((entry) => itemKey(entry) === targetKey);
  return { items: insertRelative(withoutItem, removed, targetIndex, below), emptiedFolderId };
};

// Serialize io.mindroom.spaces writes per client so a quick undo waits for the previous write's
// /sync echo instead of being skipped by matrix-js-sdk's deepCompare against stale store state.
const pendingSaves = new WeakMap<MatrixClient, Promise<unknown>>();

const enqueueSidebarSave = (mx: MatrixClient, items: SidebarItem[]): Promise<unknown> => {
  const run = (): Promise<unknown> => {
    const current = mx
      .getAccountData(AccountDataEvent.MindroomSpaces as never)
      ?.getContent<SidebarAccountData>();
    return Promise.resolve(
      mx.setAccountData(
        AccountDataEvent.MindroomSpaces as never,
        {
          ...(current ?? {}),
          sidebar: items,
        } as never
      )
    );
  };

  const prev = pendingSaves.get(mx);
  const save = prev ? prev.then(run, run) : run();
  const cleanup = () => {
    if (pendingSaves.get(mx) === save) pendingSaves.delete(mx);
  };
  void save.then(cleanup, cleanup);
  pendingSaves.set(mx, save);
  return save;
};

export const commitSidebarReorder = ({
  mx,
  orphanSpaces,
  savedItems,
  item,
  containerItem,
  instructionType,
  onEmptyFolder,
}: CommitSidebarReorderOptions): CommitSidebarReorderResult => {
  const base = withOrphans(savedItems, orphanSpaces);
  const { items, emptiedFolderId } = applyReorder(base, item, containerItem, instructionType);

  if (sameSidebarItems(items, base)) return { items: base, changed: false };

  if (emptiedFolderId) onEmptyFolder?.(emptiedFolderId);

  return { items, changed: true, save: enqueueSidebarSave(mx, items) };
};
