import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { EventTimeline, EventType, type MatrixClient, type Room } from 'matrix-js-sdk';
import { AccountDataEvent } from '../matrix/types/accountData';
import { useAccountData } from '../matrix/hooks/useAccountData';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../matrix/state/roomList';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { isSpace } from '../matrix/room';
import type { SidebarFolder, SidebarItem } from './sidebarReorder';

/**
 * The icon rail's spaces. The `sidebar` list of the `io.mindroom.spaces` account data is the
 * single source of truth for the rail's order: space IDs and folders of space IDs. Joined spaces
 * without a parent always show, after the saved entries when the list leaves them out; a subspace
 * shows only while that list names it (pinned from its lobby).
 */

type SidebarContent = { sidebar?: unknown; [key: string]: unknown };

const isFolder = (item: SidebarItem): item is SidebarFolder => typeof item !== 'string';

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** The saved entries, with anything malformed dropped. */
export const parseSidebarItems = (content: SidebarContent | undefined): SidebarItem[] => {
  const raw = content?.sidebar;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): SidebarItem[] => {
    if (typeof entry === 'string') return [entry];
    if (!entry || typeof entry !== 'object') return [];
    const { id, name, content: spaces } = entry as Record<string, unknown>;
    if (typeof id !== 'string') return [];
    return [{ id, ...(typeof name === 'string' ? { name } : {}), content: asStrings(spaces) }];
  });
};

/** When the room was made, by its create event; a room without one sorts last. */
const createdAt = (room: Room | null): number =>
  room
    ?.getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(EventType.RoomCreate, '')
    ?.getTs() ?? Number.POSITIVE_INFINITY;

/**
 * Space IDs, oldest space first. The client gets rooms in whatever order a start brings them (by
 * room ID from the server's first sync, then as they come), so a new space sat last until the next
 * start or device put it elsewhere.
 */
export const sortSpacesByAge = (client: MatrixClient, spaceIds: string[]): string[] => {
  const age = new Map(spaceIds.map((roomId) => [roomId, createdAt(client.getRoom(roomId))]));
  return [...spaceIds].sort(
    (a, b) => (age.get(a) ?? 0) - (age.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
  );
};

/** Joined spaces that sit in no other space, oldest first: the rail always shows them. */
export const useTopLevelSpaceIds = (): string[] => {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  return useMemo(
    () =>
      sortSpacesByAge(
        client,
        joinedRoomIds.filter(
          (roomId) =>
            isSpace(client.getRoom(roomId)) && (parentsByRoom.get(roomId)?.size ?? 0) === 0
        )
      ),
    [client, joinedRoomIds, parentsByRoom]
  );
};

/** The saved sidebar entries, following account data changes. */
export const useSavedSidebarItems = (): SidebarItem[] => {
  const event = useAccountData(AccountDataEvent.MindroomSpaces);
  return useMemo(() => parseSidebarItems(event?.getContent<SidebarContent>()), [event]);
};

/** Every space ID the entries mention, inside folders too. */
const sidebarSpaceIds = (items: SidebarItem[]): Set<string> => {
  const ids = new Set<string>();
  items.forEach((item) => {
    if (isFolder(item)) item.content.forEach((id) => ids.add(id));
    else ids.add(item);
  });
  return ids;
};

type ShownSidebarOptions = {
  saved: SidebarItem[];
  /** Joined spaces with no parent space. */
  topLevelSpaces: string[];
  /** Whether the user is in the space now. */
  isJoinedSpace: (roomId: string) => boolean;
};

/**
 * What the rail shows: the saved entries the user is still in (folders left empty vanish), then
 * the top-level spaces the entries leave out.
 */
export const getShownSidebarItems = ({
  saved,
  topLevelSpaces,
  isJoinedSpace,
}: ShownSidebarOptions): SidebarItem[] => {
  const seen = new Set<string>();
  const keep = (id: string) => {
    if (seen.has(id) || !isJoinedSpace(id)) return false;
    seen.add(id);
    return true;
  };
  const shown = saved.flatMap((item): SidebarItem[] => {
    if (!isFolder(item)) return keep(item) ? [item] : [];
    const content = item.content.filter(keep);
    return content.length > 0 ? [{ ...item, content }] : [];
  });
  topLevelSpaces.forEach((id) => {
    if (keep(id)) shown.push(id);
  });
  return shown;
};

/** Live icon-rail space entries shared by `SpaceTabs` and Home's space sections. */
export const useShownSidebarItems = () => {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const saved = useSavedSidebarItems();
  const topLevelSpaces = useTopLevelSpaceIds();
  const joinedSpaces = useMemo(
    () =>
      new Map(
        joinedRoomIds
          .map((roomId) => client.getRoom(roomId))
          .filter((room): room is Room => !!room && isSpace(room))
          .map((room) => [room.roomId, room])
      ),
    [client, joinedRoomIds]
  );
  const items = useMemo(
    () =>
      getShownSidebarItems({
        saved,
        topLevelSpaces,
        isJoinedSpace: (roomId) => joinedSpaces.has(roomId),
      }),
    [saved, topLevelSpaces, joinedSpaces]
  );
  return { items, saved, topLevelSpaces, joinedSpaces };
};

const writeSidebar = (client: MatrixClient, items: SidebarItem[]) => {
  const current = client
    .getAccountData(AccountDataEvent.MindroomSpaces as never)
    ?.getContent<SidebarContent>();
  return client.setAccountData(
    AccountDataEvent.MindroomSpaces as never,
    { ...(current ?? {}), sidebar: items } as never
  );
};

const readSidebar = (client: MatrixClient): SidebarItem[] =>
  parseSidebarItems(
    client.getAccountData(AccountDataEvent.MindroomSpaces as never)?.getContent<SidebarContent>()
  );

/** Whether the saved entries name `spaceId`, on its own or in a folder. */
export const isSpaceInSidebar = (items: SidebarItem[], spaceId: string): boolean =>
  sidebarSpaceIds(items).has(spaceId);

/**
 * Saves `spaceId` at the end of the rail, so a subspace shows there. The top-level spaces the
 * saved list left out are saved before it, so it lands below them rather than above.
 */
export const pinSpaceToSidebar = async (
  client: MatrixClient,
  spaceId: string,
  topLevelSpaces: string[]
): Promise<void> => {
  const items = readSidebar(client);
  if (isSpaceInSidebar(items, spaceId)) return;
  const known = sidebarSpaceIds(items);
  const unsaved = topLevelSpaces.filter((id) => !known.has(id) && id !== spaceId);
  await writeSidebar(client, [...items, ...unsaved, spaceId]);
};

/** Takes `spaceId` out of the saved entries, folders included; folders it empties go too. */
export const unpinSpaceFromSidebar = async (
  client: MatrixClient,
  spaceId: string
): Promise<void> => {
  const items = readSidebar(client);
  if (!isSpaceInSidebar(items, spaceId)) return;
  const next = items.flatMap((item): SidebarItem[] => {
    if (!isFolder(item)) return item === spaceId ? [] : [item];
    const content = item.content.filter((id) => id !== spaceId);
    return content.length > 0 ? [{ ...item, content }] : [];
  });
  await writeSidebar(client, next);
};
