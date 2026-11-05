import type { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../matrix/types/accountData';
import type { SpaceOrderAction } from './sidebarOrder';

// Sidebar entries are space room IDs or folders of space room IDs. The order
// of plain top-level spaces is a per-device preference; folders are shared
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
  /** The order the sidebar shows now, including device-local reorders. */
  sidebarItems: SidebarItem[];
  /** The order saved in account data, when it differs from what is shown. */
  accountDataSidebarItems?: SidebarItem[];
  item: SidebarDragItem;
  containerItem: SidebarDragItem;
  instructionType: SidebarInstructionType;
  onEmptyFolder?: (folderId: string) => void;
  setSpaceOrder: (action: SpaceOrderAction) => void;
};

type CommitSidebarReorderResult = {
  items: SidebarItem[];
  shouldPersistAccountData: boolean;
};

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

/** Folder changes and folder moves are shared; a plain space move stays on this device. */
const touchesFolders = (
  item: SidebarDragItem,
  containerItem: SidebarDragItem,
  instruction: SidebarInstructionType
) => isFolderDrag(item) || isFolderDrag(containerItem) || instruction === 'make-child';

const topLevelSpaceOrder = (items: SidebarItem[]): string[] =>
  items.filter((entry): entry is string => typeof entry === 'string');

export const commitSidebarReorder = ({
  mx,
  orphanSpaces,
  sidebarItems,
  accountDataSidebarItems,
  item,
  containerItem,
  instructionType,
  onEmptyFolder,
  setSpaceOrder,
}: CommitSidebarReorderOptions): CommitSidebarReorderResult => {
  const shown = withOrphans(sidebarItems, orphanSpaces);
  const { items, emptiedFolderId } = applyReorder(shown, item, containerItem, instructionType);

  if (!touchesFolders(item, containerItem, instructionType)) {
    setSpaceOrder({ type: 'REORDER', order: topLevelSpaceOrder(items) });
    return { items, shouldPersistAccountData: false };
  }

  // Apply the same change to the saved order, so a device-local order of plain
  // spaces does not leak into the shared account data.
  const saved = accountDataSidebarItems
    ? applyReorder(
        withOrphans(accountDataSidebarItems, orphanSpaces),
        item,
        containerItem,
        instructionType
      ).items
    : items;

  if (emptiedFolderId) onEmptyFolder?.(emptiedFolderId);

  const current = mx
    .getAccountData(AccountDataEvent.MindroomSpaces as never)
    ?.getContent<SidebarAccountData>();
  void mx.setAccountData(
    AccountDataEvent.MindroomSpaces as never,
    {
      ...(current ?? {}),
      sidebar: saved,
    } as never
  );

  return { items, shouldPersistAccountData: true };
};
