import { EventTimeline, type Room } from 'matrix-js-sdk';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StateEvent } from '../../../types/matrix/room';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { useDirectUsers } from '../../hooks/useDirectUsers';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveTheme, DarkTheme, LightTheme } from '../../hooks/useTheme';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useSelectedSpace } from '../../hooks/router/useSelectedSpace';
import { copyToClipboard } from '../../utils/dom';
import {
  getCanonicalAliasOrRoomId,
  getDMRoomFor,
  getMxIdLocalPart,
  guessDmRoomUserId,
  isRoomAlias,
} from '../../utils/matrix';
import { markRoomAndThreadsAsRead } from '../../utils/notifications';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { factoryRoomIdByActivity } from '../../utils/sort';
import { getAllParents, getMemberDisplayName, getStateEvent } from '../../utils/room';
import { createRoomModalAtom } from '../../state/createRoomModal';
import { createSpaceModalAtom } from '../../state/createSpaceModal';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { settingsAtom } from '../../state/settings';
import { settingsModalAtom } from '../../state/settingsModal';
import { useSetting } from '../../state/hooks/settings';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { useDirects, useRooms, useSpaces } from '../../state/hooks/roomList';
import { makeRecentThreadsAtom } from '../../mindroom/recent-threads/recentThreads';
import { buildCommandPaletteThreadViewModelFromRecord } from '../../mindroom/threads/commandPaletteThreadViewModel';
import { buildThreadRecord } from '../../mindroom/threads/threadRecord';
import { getResolvedRecentThreadRootId } from '../../mindroom/recent-threads/recentThreadSummaryUtils';
import { resolveCanonicalThreadRootId } from '../../mindroom/threads/threadRouteUtils';
import { getValidThreadRootEvent } from '../../mindroom/threads/threadUtils';
import {
  aggregateThreadTagEvents,
  buildPerTagEventContent,
  buildPerTagStateKey,
  getDisplayTags,
  isThreadResolved,
  RESOLVED_TAG,
} from '../../mindroom/threads/threadTags';
import {
  commandPaletteStaticActionPaths,
  getCommandPaletteMessageTargets,
  getCommandPaletteQuickActions,
  resolveCommandPaletteUserTarget,
  type CommandPaletteQuickActionId,
} from './commandPaletteActions';
import type {
  CommandPaletteActionItem,
  CommandPaletteItem,
  CommandPaletteMessageItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';

export type ExecutableCommandPaletteItem = CommandPaletteItem & {
  onSelect?: () => void;
};

export type CommandPaletteSource = {
  actions: readonly (CommandPaletteActionItem & { onSelect?: () => void })[];
  threads: readonly (CommandPaletteThreadItem & { onSelect?: () => void })[];
  rooms: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
  users: readonly (CommandPaletteUserItem & { onSelect?: () => void })[];
  getMessages: (query: string) => (CommandPaletteMessageItem & { onSelect?: () => void })[];
};

type UseCommandPaletteSourceOptions = {
  onLogout?: () => void;
};

type ThreadTagSnapshot = {
  isResolved: boolean;
  tags: string[];
};

const getRoomTopic = (room: Room): string | undefined => {
  const content = getStateEvent(room, StateEvent.RoomTopic)?.getContent();
  return typeof content?.topic === 'string' ? content.topic : undefined;
};

const mapUserDisplayName = (room: Room, userId: string): string =>
  getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;

const fireAndForget = <T,>(promise: Promise<T>) => {
  promise.catch(() => undefined);
};

const getThreadTagSnapshots = (room: Room): Map<string, ThreadTagSnapshot> => {
  const stateEvents =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(StateEvent.ThreadTags as string) ?? [];

  if (!Array.isArray(stateEvents) || stateEvents.length === 0) {
    return new Map();
  }

  const snapshots = new Map<string, ThreadTagSnapshot>();
  aggregateThreadTagEvents(stateEvents).forEach((content, threadRootId) => {
    snapshots.set(threadRootId, {
      isResolved: isThreadResolved(content),
      tags: getDisplayTags(content),
    });
  });

  return snapshots;
};

const buildThreadResolutionFromTagSnapshot = (
  tagSnapshot: ThreadTagSnapshot | undefined
): { isResolved: boolean; tags: Record<string, unknown> | null } | undefined => {
  if (!tagSnapshot) return undefined;

  return {
    isResolved: tagSnapshot.isResolved,
    tags: Object.fromEntries(tagSnapshot.tags.map((tagName) => [tagName, true])),
  };
};

const toCommandPaletteThreadItem = (
  viewModel: ReturnType<typeof buildCommandPaletteThreadViewModelFromRecord>,
  onSelect: () => void
): CommandPaletteThreadItem & { onSelect: () => void } => ({
  id: `${viewModel.id.roomId}|${viewModel.id.threadRootId}`,
  kind: 'thread',
  roomId: viewModel.id.roomId,
  threadId: viewModel.id.threadRootId,
  summaryText: viewModel.summaryText,
  roomName: viewModel.roomName,
  participantNames: viewModel.participantNames,
  tags: viewModel.tags,
  isResolved: viewModel.isResolved,
  messageCount: viewModel.messageCount,
  sortRank: viewModel.sortRank,
  boost: viewModel.boost,
  onSelect,
});

const mergeThreadItems = (
  left: CommandPaletteThreadItem,
  right: CommandPaletteThreadItem
): CommandPaletteThreadItem => ({
  ...left,
  ...right,
  summaryText:
    left.summaryText === 'Thread'
      ? right.summaryText
      : right.summaryText === 'Thread'
        ? left.summaryText
        : right.summaryText,
  participantNames:
    right.participantNames && right.participantNames.length > 0
      ? right.participantNames
      : left.participantNames,
  tags: right.tags && right.tags.length > 0 ? right.tags : left.tags,
  isResolved: right.isResolved ?? left.isResolved,
  messageCount: right.messageCount ?? left.messageCount,
  sortRank: Math.max(left.sortRank ?? 0, right.sortRank ?? 0),
  boost: Math.max(left.boost ?? 0, right.boost ?? 0),
});

export const useCommandPaletteSource = (
  options: UseCommandPaletteSourceOptions = {}
): CommandPaletteSource => {
  const { onLogout } = options;
  const mx = useMatrixClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const settings = useAtomValue(settingsAtom);
  const setSettings = useSetAtom(settingsAtom);
  const activeTheme = useActiveTheme();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const setCreateRoomModal = useSetAtom(createRoomModalAtom);
  const setCreateSpaceModal = useSetAtom(createSpaceModalAtom);
  const selectedRoomId = useSelectedRoom();
  const selectedSpaceId = useSelectedSpace();
  const openRoomSettings = useOpenRoomSettings();
  const { navigateRoom, navigateSpace, navigateRoomThread } = useRoomNavigate();
  const myUserId = mx.getSafeUserId();

  const currentThreadId = useMemo(
    () => getRoomSearchParams(new URLSearchParams(location.search)).threadId,
    [location.search]
  );

  const allJoinedRooms = useAllJoinedRoomsSet();
  const allJoinedRoomIds = useMemo(() => Array.from(allJoinedRooms), [allJoinedRooms]);
  const getRoom = useGetRoom(allJoinedRooms);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const directUsers = useDirectUsers();
  const rooms = useRooms(mx, allRoomsAtom, mDirects);
  const spaces = useSpaces(mx, allRoomsAtom);
  const directs = useDirects(mx, allRoomsAtom, mDirects);
  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(myUserId), [myUserId]);
  const recentThreads = useAtomValue(recentThreadsAtom);

  const selectedRoom = selectedRoomId ? getRoom(selectedRoomId) : undefined;
  const selectedSpace = selectedSpaceId ? getRoom(selectedSpaceId) : undefined;
  const canonicalSelectedThreadId =
    selectedRoom && currentThreadId
      ? resolveCanonicalThreadRootId(selectedRoom, currentThreadId) ?? currentThreadId
      : undefined;

  const orderedRoomIds = useMemo(
    () => [...rooms, ...spaces].sort(factoryRoomIdByActivity(mx)),
    [mx, rooms, spaces]
  );
  const roomActivityRank = useMemo(() => {
    const rank = new Map<string, number>();
    const size = orderedRoomIds.length;
    orderedRoomIds.forEach((roomId, index) => {
      rank.set(roomId, size - index);
    });
    return rank;
  }, [orderedRoomIds]);

  const orderedDirectIds = useMemo(
    () => [...directs].sort(factoryRoomIdByActivity(mx)),
    [directs, mx]
  );
  const dmRoomByUserId = useMemo(() => {
    const map = new Map<string, string>();

    orderedDirectIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;

      const userId = guessDmRoomUserId(room, myUserId);
      if (!userId || userId === myUserId || map.has(userId)) return;
      map.set(userId, room.roomId);
    });

    directUsers.forEach((userId) => {
      if (map.has(userId)) return;
      const room = getDMRoomFor(mx, userId);
      if (room) {
        map.set(userId, room.roomId);
      }
    });

    return map;
  }, [directUsers, getRoom, mx, myUserId, orderedDirectIds]);

  const directActivityRank = useMemo(() => {
    const rank = new Map<string, number>();
    const size = orderedDirectIds.length;

    orderedDirectIds.forEach((roomId, index) => {
      rank.set(roomId, size - index);
    });

    return rank;
  }, [orderedDirectIds]);

  const roomItems = useMemo(
    () =>
      orderedRoomIds.reduce<(CommandPaletteRoomItem & { onSelect: () => void })[]>((items, roomId) => {
        const room = getRoom(roomId);
        if (!room) return items;

        const parentNames = Array.from(getAllParents(roomToParents, room.roomId))
          .map((parentId) => getRoom(parentId)?.name ?? parentId)
          .sort((left, right) => left.localeCompare(right));
        const unread = roomToUnread.get(room.roomId);

        items.push({
          id: room.roomId,
          kind: room.isSpaceRoom() ? 'space' : 'room',
          name: room.name,
          canonicalAlias: room.getCanonicalAlias() ?? undefined,
          topic: getRoomTopic(room),
          parentNames,
          unreadCount: unread?.total,
          unreadHighlight: unread ? unread.highlight > 0 : undefined,
          sortRank: roomActivityRank.get(room.roomId) ?? 0,
          boost:
            (room.roomId === selectedRoomId ? 30 : 0) +
            (room.roomId === selectedSpaceId ? 15 : 0) +
            ((unread?.total ?? 0) > 0 ? 15 : 0) +
            ((unread?.highlight ?? 0) > 0 ? 10 : 0),
          onSelect: () => {
            if (room.isSpaceRoom()) {
              navigateSpace(room.roomId);
              return;
            }

            navigateRoom(room.roomId);
          },
        });

        return items;
      }, []),
    [
      getRoom,
      navigateRoom,
      navigateSpace,
      orderedRoomIds,
      roomActivityRank,
      roomToParents,
      roomToUnread,
      selectedRoomId,
      selectedSpaceId,
    ]
  );

  const currentRoomMemberIds = useMemo(
    () => new Set(selectedRoom?.getJoinedMembers().map((member) => member.userId) ?? []),
    [selectedRoom]
  );

  const userItems = useMemo(() => {
    const items = new Map<string, CommandPaletteUserItem & { onSelect: () => void }>();

    const upsertUser = (
      userId: string,
      displayName: string | undefined,
      sourceRoomId?: string
    ) => {
      if (!userId || userId === myUserId) return;

      const existingDmRoomId = dmRoomByUserId.get(userId);
      const dmRoomName = existingDmRoomId ? getRoom(existingDmRoomId)?.name : undefined;
      const localpart = getMxIdLocalPart(userId) ?? userId;
      const target = resolveCommandPaletteUserTarget(userId, existingDmRoomId);
      const baseSortRank = sourceRoomId ? roomActivityRank.get(sourceRoomId) ?? 0 : 0;
      const dmSortRank = existingDmRoomId ? directActivityRank.get(existingDmRoomId) ?? 0 : 0;
      const boost =
        (existingDmRoomId ? 25 : 0) + (currentRoomMemberIds.has(userId) ? 15 : 0);
      const nextItem: CommandPaletteUserItem & { onSelect: () => void } = {
        id: userId,
        kind: 'user',
        displayName: displayName ?? localpart,
        userId,
        localpart,
        dmRoomName,
        existingDmRoomId,
        sortRank: Math.max(baseSortRank, dmSortRank),
        boost,
        onSelect: () => {
          if (target.kind === 'room') {
            navigateRoom(target.roomId);
            return;
          }

          navigate(target.path);
        },
      };

      const existing = items.get(userId);
      if (!existing) {
        items.set(userId, nextItem);
        return;
      }

      items.set(userId, {
        ...existing,
        displayName:
          existing.displayName === existing.localpart && nextItem.displayName !== nextItem.localpart
            ? nextItem.displayName
            : existing.displayName,
        dmRoomName: nextItem.dmRoomName ?? existing.dmRoomName,
        existingDmRoomId: nextItem.existingDmRoomId ?? existing.existingDmRoomId,
        sortRank: Math.max(existing.sortRank ?? 0, nextItem.sortRank ?? 0),
        boost: Math.max(existing.boost ?? 0, nextItem.boost ?? 0),
      });
    };

    directUsers.forEach((userId) => {
      upsertUser(userId, getMxIdLocalPart(userId) ?? userId);
    });

    [...allJoinedRoomIds]
      .sort(factoryRoomIdByActivity(mx))
      .forEach((roomId) => {
        const room = getRoom(roomId);
        if (!room) return;

        room.getJoinedMembers().forEach((member) => {
          upsertUser(
            member.userId,
            member.rawDisplayName !== member.userId ? member.rawDisplayName : undefined,
            room.roomId
          );
        });
      });

    return Array.from(items.values());
  }, [
    allJoinedRoomIds,
    currentRoomMemberIds,
    directActivityRank,
    directUsers,
    dmRoomByUserId,
    getRoom,
    mx,
    myUserId,
    navigate,
    navigateRoom,
    roomActivityRank,
  ]);

  const threadTagSnapshots = useMemo(() => {
    const snapshots = new Map<string, Map<string, ThreadTagSnapshot>>();

    allJoinedRoomIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      snapshots.set(room.roomId, getThreadTagSnapshots(room));
    });

    return snapshots;
  }, [allJoinedRoomIds, getRoom]);

  const currentThreadResolved = useMemo(() => {
    if (!selectedRoom || !canonicalSelectedThreadId) return false;

    return threadTagSnapshots.get(selectedRoom.roomId)?.get(canonicalSelectedThreadId)?.isResolved ?? false;
  }, [canonicalSelectedThreadId, selectedRoom, threadTagSnapshots]);

  const setCurrentThreadResolved = useCallback(
    (resolved: boolean) => {
      if (!selectedRoom || !canonicalSelectedThreadId) return;

      const rootEvent = getValidThreadRootEvent(selectedRoom, canonicalSelectedThreadId);
      const threadRootId = rootEvent?.getId();
      if (!threadRootId) return;

      fireAndForget(
        mx.sendStateEvent(
          selectedRoom.roomId,
          StateEvent.ThreadTags as any,
          resolved ? buildPerTagEventContent(myUserId) : {},
          buildPerTagStateKey(threadRootId, RESOLVED_TAG)
        )
      );
    },
    [canonicalSelectedThreadId, mx, myUserId, selectedRoom]
  );

  const threadItems = useMemo(() => {
    const items = new Map<string, CommandPaletteThreadItem & { onSelect: () => void }>();

    const upsert = (item: CommandPaletteThreadItem & { onSelect: () => void }) => {
      const existing = items.get(item.id);
      if (!existing) {
        items.set(item.id, item);
        return;
      }

      items.set(item.id, {
        ...mergeThreadItems(existing, item),
        onSelect: item.onSelect,
      });
    };

    recentThreads.forEach((entry) => {
      const room = getRoom(entry.roomId);
      if (!room) return;

      const threadRootId = getResolvedRecentThreadRootId(room, entry.threadId);
      const rootEvent = room.findEventById(threadRootId) ?? room.getThread(threadRootId)?.rootEvent;
      const tagSnapshot = threadTagSnapshots.get(room.roomId)?.get(threadRootId);
      const record = buildThreadRecord({
        room,
        threadRootId,
        threadRootEvent: rootEvent,
        threadResolution: buildThreadResolutionFromTagSnapshot(tagSnapshot),
      });
      const viewModel = buildCommandPaletteThreadViewModelFromRecord({
        record,
        roomName: room.name,
        getParticipantName: (userId) => mapUserDisplayName(room, userId),
        fallbackSummaryText: entry.summaryText,
        sortRank: entry.openedAt,
        boost:
          (room.roomId === selectedRoomId ? 10 : 0) +
          (threadRootId === canonicalSelectedThreadId ? 30 : 0) +
          (tagSnapshot && !tagSnapshot.isResolved ? 10 : 0),
      });

      upsert(toCommandPaletteThreadItem(viewModel, () => navigateRoomThread(room.roomId, threadRootId)));
    });

    allJoinedRoomIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room || typeof room.getThreads !== 'function') return;

      room.getThreads().forEach((thread) => {
        const threadRootId = resolveCanonicalThreadRootId(room, thread.id) ?? thread.id;
        const rootEvent = thread.rootEvent ?? room.findEventById(threadRootId);
        const tagSnapshot = threadTagSnapshots.get(room.roomId)?.get(threadRootId);
        const record = buildThreadRecord({
          room,
          threadRootId,
          threadRootEvent: rootEvent,
          threadResolution: buildThreadResolutionFromTagSnapshot(tagSnapshot),
        });
        const viewModel = buildCommandPaletteThreadViewModelFromRecord({
          record,
          roomName: room.name,
          getParticipantName: (userId) => mapUserDisplayName(room, userId),
          boost:
            (room.roomId === selectedRoomId ? 10 : 0) +
            (threadRootId === canonicalSelectedThreadId ? 30 : 0) +
            (tagSnapshot && !tagSnapshot.isResolved ? 10 : 0),
        });

        upsert(toCommandPaletteThreadItem(viewModel, () => navigateRoomThread(room.roomId, threadRootId)));
      });
    });

    return Array.from(items.values());
  }, [
    allJoinedRoomIds,
    canonicalSelectedThreadId,
    getRoom,
    navigateRoomThread,
    recentThreads,
    selectedRoomId,
    threadTagSnapshots,
  ]);

  const actionCallbacks = useMemo<Record<CommandPaletteQuickActionId, () => void>>(
    () => ({
      'open-settings': () => setSettingsModal({}),
      'go-home': () => navigate(commandPaletteStaticActionPaths.goHome),
      'go-direct': () => navigate(commandPaletteStaticActionPaths.goDirect),
      'go-inbox': () => navigate(commandPaletteStaticActionPaths.goInbox),
      'create-room': () => setCreateRoomModal({ spaceId: selectedSpace?.roomId }),
      'create-space': () => setCreateSpaceModal({ spaceId: selectedSpace?.roomId }),
      'mark-current-room-read': () => {
        if (!selectedRoom) return;
        fireAndForget(markRoomAndThreadsAsRead(mx, selectedRoom.roomId, hideActivity));
      },
      'copy-current-room-link': () => {
        if (!selectedRoom) return;
        const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, selectedRoom.roomId);
        const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(selectedRoom);
        copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
      },
      'open-current-room-settings': () => {
        if (!selectedRoom) return;
        openRoomSettings(selectedRoom.roomId, selectedSpace?.roomId);
      },
      'resolve-current-thread': () => setCurrentThreadResolved(true),
      'unresolve-current-thread': () => setCurrentThreadResolved(false),
      'toggle-theme': () => {
        const nextThemeId = activeTheme.kind === 'dark' ? LightTheme.id : DarkTheme.id;
        setSettings({
          ...settings,
          useSystemTheme: false,
          themeId: nextThemeId,
        });
      },
      'logout': () => {
        onLogout?.();
      },
    }),
    [
      activeTheme.kind,
      hideActivity,
      mx,
      navigate,
      onLogout,
      openRoomSettings,
      selectedRoom,
      selectedSpace,
      setSettings,
      setCreateRoomModal,
      setCreateSpaceModal,
      setCurrentThreadResolved,
      setSettingsModal,
      settings,
    ]
  );

  const actions = useMemo(
    () =>
      getCommandPaletteQuickActions({
        currentRoomName: selectedRoom?.name ?? selectedRoom?.roomId,
        currentThreadId: canonicalSelectedThreadId,
        isCurrentThreadResolved: currentThreadResolved,
      }).map((item) => ({
        ...item,
        onSelect: actionCallbacks[item.id as CommandPaletteQuickActionId],
      })),
    [
      actionCallbacks,
      canonicalSelectedThreadId,
      currentThreadResolved,
      selectedRoom?.name,
      selectedRoom?.roomId,
    ]
  );

  const getMessages = useCallback(
    (query: string) =>
      getCommandPaletteMessageTargets({
        query,
        currentRoomId: selectedRoom?.roomId,
        currentRoomName: selectedRoom?.name,
        currentSpaceId: selectedSpace
          ? getCanonicalAliasOrRoomId(mx, selectedSpace.roomId)
          : undefined,
        currentSpaceName: selectedSpace?.name,
      }).map((item) => ({
        ...item,
        onSelect: () => navigate(item.path),
      })),
    [mx, navigate, selectedRoom, selectedSpace]
  );

  return {
    actions,
    threads: threadItems,
    rooms: roomItems,
    users: userItems,
    getMessages,
  };
};
