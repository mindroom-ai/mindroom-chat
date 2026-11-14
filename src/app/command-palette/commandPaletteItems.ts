import { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EventTimeline, Room } from 'matrix-js-sdk';
import { StateEvent } from '../matrix/types/room';
import { useDirectUsers } from '../matrix/hooks/useDirectUsers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { useSelectedSpace } from '../navigation/useSelectedSpace';
import { DarkTheme, LightTheme, ThemeKind, useTheme } from '../theme/useTheme';
import { getMatrixToRoom } from '../matrix/matrix-to';
import { getViaServers } from '../matrix/via-servers';
import { useOpenCreateRoomModal } from '../navigation/useCreateRoomModal';
import { useOpenCreateSpaceModal } from '../navigation/useCreateSpaceModal';
import { useOpenRoomSettings } from '../navigation/useRoomSettingsState';
import { useSetting } from '../preferences/useSetting';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { allRoomsAtom } from '../matrix/state/roomList';
import { settingsAtom } from '../preferences/settings';
import { settingsModalAtom } from '../navigation/settingsModal';
import { copyToClipboard } from '../lib/dom';
import { getCanonicalAliasOrRoomId, getMxIdLocalPart } from '../matrix/matrix';
import { getMemberAvatarMxc } from '../matrix/room';
import { crossRoomThreadIndexAtom } from '../threads/cross-room/crossRoomThreadIndex';
import { useMarkRoomsRead } from '../notifications/useMarkRoomsRead';
import { archivedRoomsAtom, isRoomVisible } from '../matrix/state/archivedRooms';
import { isThreadPinned } from '../event-store/threads/threadPinning';
import { useThreadResolution, useToggleThreadResolution } from '../threads/tags/useRoomThreadTags';
import {
  type CommandPaletteQuickActionId,
  commandPaletteStaticActionPaths,
  getCommandPaletteQuickActions,
} from './commandPaletteActions';
import { getCommandPaletteRoomRanking } from './commandPaletteRoomRanking';
import type {
  CommandPaletteActionItem,
  CommandPaletteItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';
import {
  buildCommandPaletteDmRoomMap,
  collectCommandPaletteUserCandidates,
  getCommandPaletteDmUserDetails,
} from './commandPaletteUserCandidates';
import { getCommandPaletteAvatarUrl, useStartDirectChat } from './useCommandPalettePeople';

type Executable<T> = T & { onSelect?: () => void };

/**
 * A person: choosing them opens the direct chat with them (`onSelect`). Without one there is
 * `startChat` instead, which the palette asks about first; it resolves once the new chat is open.
 */
export type ExecutableCommandPaletteUserItem = Executable<CommandPaletteUserItem> & {
  startChat?: () => Promise<void>;
};

/** A palette row together with what choosing it does. */
export type ExecutableCommandPaletteItem =
  | Executable<Exclude<CommandPaletteItem, CommandPaletteUserItem>>
  | ExecutableCommandPaletteUserItem;

/** How far the Users section looks: past its caps for a typed query, into other rooms when asked. */
type CommandPaletteUserQuery = { exhaustive: boolean; includeRelatedRooms: boolean };

/**
 * What the palette finds in state the client already holds, so it shows at the first keystroke;
 * users are built on demand. Messages come from the server (`useCommandPaletteMessages`).
 */
export type CommandPaletteSource = {
  actions: Executable<CommandPaletteActionItem>[];
  threads: Executable<CommandPaletteThreadItem>[];
  rooms: readonly Executable<CommandPaletteRoomItem>[];
  getUsers: (query: CommandPaletteUserQuery) => ExecutableCommandPaletteUserItem[];
};

type CommandPaletteSourceOptions = {
  /** Logging out asks for confirmation, which the caller shows. */
  onLogout?: () => void;
};

const liveState = (room: Room) => room.getLiveTimeline().getState(EventTimeline.FORWARDS);

const roomTopic = (room: Room): string | undefined => {
  const topic = liveState(room)?.getStateEvents(StateEvent.RoomTopic, '')?.getContent().topic;
  return typeof topic === 'string' && topic ? topic : undefined;
};

/**
 * The command palette's items for the signed-in account: quick actions for where the user is,
 * recent threads, rooms and spaces ranked by activity and unread state, and people. Lists keep
 * their identity while their inputs do, so search indexes are reused.
 */
export const useCommandPaletteSource = ({
  onLogout,
}: CommandPaletteSourceOptions = {}): CommandPaletteSource => {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { navigateRoom, navigateSpace, navigateRoomThread } = useRoomNavigate();
  const selectedRoomId = useSelectedRoom();
  const [searchParams] = useSearchParams();
  const selectedThreadId = selectedRoomId ? searchParams.get('threadId') ?? undefined : undefined;
  const selectedSpaceId = useSelectedSpace();
  const allRoomIds = useAtomValue(allRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const archivedRooms = useAtomValue(archivedRoomsAtom);
  const threadIndex = useAtomValue(crossRoomThreadIndexAtom);
  const directUsers = useDirectUsers();
  const useAuthentication = useMediaAuthentication();
  const startChat = useStartDirectChat();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const openCreateRoom = useOpenCreateRoomModal();
  const openCreateSpace = useOpenCreateSpaceModal();
  const openRoomSettings = useOpenRoomSettings();
  const markRoomsRead = useMarkRoomsRead();
  const [, setUseSystemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [, setThemeId] = useSetting(settingsAtom, 'themeId');
  const theme = useTheme();
  const myUserId = client.getSafeUserId();

  const getRoom = useCallback((roomId: string) => client.getRoom(roomId) ?? undefined, [client]);
  const currentRoom = selectedRoomId ? getRoom(selectedRoomId) : undefined;

  // Joined rooms by latest activity, newest first; DMs are offered through the people they are with.
  const orderedRoomIds = useMemo(
    () =>
      allRoomIds
        .map((roomId) => getRoom(roomId))
        .filter((room): room is Room => !!room && isRoomVisible(room.roomId, archivedRooms))
        .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
        .map((room) => room.roomId),
    [allRoomIds, archivedRooms, getRoom]
  );

  const rooms = useMemo<Executable<CommandPaletteRoomItem>[]>(() => {
    const items: Executable<CommandPaletteRoomItem>[] = [];
    const roomCount = orderedRoomIds.length;
    orderedRoomIds.forEach((roomId, index) => {
      const room = getRoom(roomId);
      if (!room || directRoomIds.has(roomId)) return;
      const unread = roomToUnread.get(roomId);
      const space = room.isSpaceRoom();
      const parentNames = Array.from(roomToParents.get(roomId) ?? [])
        .map((parentId) => getRoom(parentId)?.name)
        .filter((name): name is string => !!name);
      items.push({
        id: `room:${roomId}`,
        kind: space ? 'space' : 'room',
        name: room.name,
        canonicalAlias: room.getCanonicalAlias() ?? undefined,
        topic: roomTopic(room),
        parentNames: parentNames.length > 0 ? parentNames : undefined,
        unreadCount: unread?.total,
        unreadHighlight: (unread?.highlight ?? 0) > 0,
        ...getCommandPaletteRoomRanking({
          roomId,
          selectedRoomId,
          selectedSpaceId,
          activityRank: roomCount - index,
          unreadTotal: unread?.total ?? 0,
          unreadHighlights: unread?.highlight ?? 0,
        }),
        onSelect: () => (space ? navigateSpace(roomId) : navigateRoom(roomId)),
      });
    });
    return items;
  }, [
    directRoomIds,
    getRoom,
    navigateRoom,
    navigateSpace,
    orderedRoomIds,
    roomToParents,
    roomToUnread,
    selectedRoomId,
    selectedSpaceId,
  ]);

  const threads = useMemo<Executable<CommandPaletteThreadItem>[]>(
    () =>
      Array.from(threadIndex.entries.values())
        .filter((entry) => isRoomVisible(entry.roomId, archivedRooms))
        .sort((a, b) => b.lastActivityTs - a.lastActivityTs)
        .map((entry, index, entries) => ({
          id: `thread:${entry.key}`,
          kind: 'thread',
          roomId: entry.roomId,
          threadId: entry.threadRootId,
          summaryText: entry.summaryText || entry.rootPreviewText,
          isFallbackSummary: !entry.summaryText,
          roomName: entry.roomName,
          tags: entry.tags,
          isResolved: entry.isResolved,
          // The thread already open goes last, like the room already open.
          sortRank:
            entry.roomId === selectedRoomId && entry.threadRootId === selectedThreadId
              ? 0
              : entries.length - index,
          boost: entry.isUnread ? 10 : 0,
          onSelect: () => navigateRoomThread(entry.roomId, entry.threadRootId),
        })),
    [archivedRooms, navigateRoomThread, selectedRoomId, selectedThreadId, threadIndex.entries]
  );

  const currentThreadId = currentRoom ? selectedThreadId : undefined;
  // The thread tag hooks need a room; without one open, no thread action is offered anyway.
  const noRoom = useMemo(
    () => new Room('!command-palette:invalid', client, myUserId),
    [client, myUserId]
  );
  const resolutionRoom = currentRoom ?? noRoom;
  const { isResolved: currentThreadResolved } = useThreadResolution(
    resolutionRoom,
    currentThreadId
  );
  const { canToggle, setResolved } = useToggleThreadResolution(resolutionRoom);
  const canResolveThread = !!currentRoom && !!currentThreadId && canToggle;
  const actions = useMemo<Executable<CommandPaletteActionItem>[]>(() => {
    const items = getCommandPaletteQuickActions(
      {
        currentRoomName: currentRoom?.name,
        currentThreadId,
        isCurrentThreadResolved: currentThreadId ? currentThreadResolved : undefined,
        isCurrentThreadPinned:
          currentRoom && currentThreadId ? isThreadPinned(currentRoom, currentThreadId) : undefined,
      },
      t
    );
    const goTo = (path: string) => () => navigate(path);
    // Room actions exist only while a room is open; thread ones also need the right to tag.
    const inCurrentRoom = (action: (room: Room) => void) =>
      currentRoom ? () => action(currentRoom) : undefined;
    const markCurrentThread = (resolved: boolean) =>
      canResolveThread && currentThreadId
        ? () => {
            void setResolved(currentThreadId, resolved);
          }
        : undefined;
    const copyRoomLink = (room: Room) => {
      const idOrAlias = getCanonicalAliasOrRoomId(client, room.roomId);
      // An alias resolves on its own; a bare room ID needs servers to join through.
      const via = idOrAlias.startsWith('!') ? getViaServers(room) : undefined;
      copyToClipboard(getMatrixToRoom(idOrAlias, via)).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[command-palette] could not copy the room link', error);
      });
    };
    const run: Record<CommandPaletteQuickActionId, (() => void) | undefined> = {
      logout: onLogout,
      'toggle-theme': () => {
        setUseSystemTheme(false);
        setThemeId(theme.kind === ThemeKind.Dark ? LightTheme.id : DarkTheme.id);
      },
      'go-direct': goTo(commandPaletteStaticActionPaths.goDirect),
      'go-home': goTo(commandPaletteStaticActionPaths.goHome),
      'go-activity': goTo(commandPaletteStaticActionPaths.goActivity),
      'create-space': () => openCreateSpace(selectedSpaceId),
      'create-room': () => openCreateRoom(selectedSpaceId),
      'open-settings': () => setSettingsModal({}),
      'copy-current-room-link': inCurrentRoom(copyRoomLink),
      'mark-current-room-read': inCurrentRoom((room) => {
        void markRoomsRead([room.roomId]);
      }),
      'open-current-room-settings': inCurrentRoom((room) => openRoomSettings(room.roomId)),
      // The thread tag write path checks the root, shows the change at once and reports errors.
      'resolve-current-thread': markCurrentThread(true),
      'unresolve-current-thread': markCurrentThread(false),
    };
    // Resolving needs the right to set thread tags; without it the action is not offered.
    return items
      .filter(
        (item) =>
          canResolveThread ||
          (item.id !== 'resolve-current-thread' && item.id !== 'unresolve-current-thread')
      )
      .map((item) => ({
        ...item,
        onSelect: run[item.id as CommandPaletteQuickActionId],
      }));
  }, [
    canResolveThread,
    currentRoom,
    currentThreadId,
    currentThreadResolved,
    client,
    markRoomsRead,
    navigate,
    onLogout,
    openCreateRoom,
    openCreateSpace,
    openRoomSettings,
    selectedSpaceId,
    setSettingsModal,
    setResolved,
    setThemeId,
    setUseSystemTheme,
    t,
    theme.kind,
  ]);

  const dmRoomByUserId = useMemo(
    () =>
      buildCommandPaletteDmRoomMap({
        directRoomIds: Array.from(directRoomIds),
        getRoom,
        joinedRoomIds: allRoomIds,
        myUserId,
      }),
    [allRoomIds, directRoomIds, getRoom, myUserId]
  );

  // One list per query shape, so repeated renders reuse the search index built for it.
  const userLists = useMemo(
    () => new Map<string, ExecutableCommandPaletteUserItem[]>(),
    [
      allRoomIds,
      directUsers,
      dmRoomByUserId,
      orderedRoomIds,
      selectedRoomId,
      startChat,
      useAuthentication,
    ]
  );
  const getUsers = useCallback(
    ({ exhaustive, includeRelatedRooms }: CommandPaletteUserQuery) => {
      const key = `${exhaustive}:${includeRelatedRooms}`;
      const cached = userLists.get(key);
      if (cached) return cached;
      const { candidates, currentRoomMemberIds } = collectCommandPaletteUserCandidates({
        directUsers,
        exhaustive,
        getRoom,
        includeRelatedRooms,
        myUserId,
        orderedRoomIds,
        selectedRoomId,
      });
      const items = candidates.map((candidate): ExecutableCommandPaletteUserItem => {
        const { userId, sourceRoomId } = candidate;
        const dmRoomId = dmRoomByUserId.get(userId);
        const dmRoom = dmRoomId ? getRoom(dmRoomId) : undefined;
        const dm = getCommandPaletteDmUserDetails(dmRoom, userId);
        const localpart = getMxIdLocalPart(userId) ?? userId;
        // The room they were found in shows their avatar; people from m.direct alone, the DM.
        const memberRoom = (sourceRoomId ? getRoom(sourceRoomId) : undefined) ?? dmRoom;
        return {
          id: `user:${userId}`,
          kind: 'user',
          userId,
          displayName: candidate.displayName ?? dm.displayName ?? localpart,
          localpart,
          dmRoomName: dm.roomName,
          existingDmRoomId: dmRoomId,
          avatarUrl: getCommandPaletteAvatarUrl(
            client,
            memberRoom && getMemberAvatarMxc(memberRoom, userId),
            useAuthentication
          ),
          boost: (dmRoomId ? 10 : 0) + (currentRoomMemberIds.has(userId) ? 5 : 0),
          ...(dmRoomId
            ? { onSelect: () => navigateRoom(dmRoomId) }
            : { startChat: () => startChat(userId) }),
        };
      });
      userLists.set(key, items);
      return items;
    },
    [
      client,
      directUsers,
      dmRoomByUserId,
      getRoom,
      myUserId,
      navigateRoom,
      orderedRoomIds,
      selectedRoomId,
      startChat,
      useAuthentication,
      userLists,
    ]
  );

  return useMemo(
    () => ({ actions, threads, rooms, getUsers }),
    [actions, getUsers, rooms, threads]
  );
};
