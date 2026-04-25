import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import type { CommandPaletteThreadItem } from '../command-palette/commandPaletteTypes';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import {
  makeRecentThreadsAtom,
  type RecentThreadItem,
} from '../recent-threads/recentThreads';
import { getResolvedRecentThreadRootId } from '../recent-threads/recentThreadSummaryUtils';
import { buildCommandPaletteThreadViewModelFromRecord } from './commandPaletteThreadViewModel';
import { buildThreadRecord } from './threadRecord';
import { resolveCanonicalThreadRootId } from './threadRouteUtils';
import { getValidThreadRootEvent } from './threadUtils';
import {
  aggregateThreadTagEvents,
  buildPerTagEventContent,
  buildPerTagStateKey,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from './threadTags';

type ThreadTagSnapshot = {
  isResolved: boolean;
  tags: string[];
};

type MindroomCommandPaletteThreadItem = CommandPaletteThreadItem & { onSelect: () => void };

type UseMindroomCommandPaletteThreadItemsOptions = {
  mx: MatrixClient;
  myUserId: string;
  allJoinedRoomIds: readonly string[];
  getRoom: (roomId: string) => Room | undefined;
  selectedRoom?: Room | undefined;
  selectedRoomId?: string | undefined;
  currentThreadId?: string | undefined;
  navigateRoomThread: (roomId: string, threadId: string) => void;
};

const fireAndForget = <T,>(promise: Promise<T>) => {
  promise.catch(() => undefined);
};

const mapUserDisplayName = (room: Room, userId: string): string =>
  getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;

export const getMindroomThreadTagSnapshots = (room: Room): Map<string, ThreadTagSnapshot> => {
  const stateEvents =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT) ?? [];

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

export const buildThreadResolutionFromTagSnapshot = (
  tagSnapshot: ThreadTagSnapshot | undefined
): { isResolved: boolean; tags: Record<string, unknown> | null } | undefined => {
  if (!tagSnapshot) return undefined;

  return {
    isResolved: tagSnapshot.isResolved,
    tags: Object.fromEntries(tagSnapshot.tags.map((tagName) => [tagName, true])),
  };
};

export const resolveCommandPaletteCurrentThreadRootId = (
  selectedRoom: Room | undefined,
  currentThreadId: string | undefined
): string | undefined =>
  selectedRoom && currentThreadId
    ? resolveCanonicalThreadRootId(selectedRoom, currentThreadId) ?? currentThreadId
    : undefined;

export const mergeCommandPaletteThreadItems = (
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

const toCommandPaletteThreadItem = (
  viewModel: ReturnType<typeof buildCommandPaletteThreadViewModelFromRecord>,
  onSelect: () => void
): MindroomCommandPaletteThreadItem => ({
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

const buildRecentThreadItem = ({
  entry,
  room,
  threadTagSnapshots,
  selectedRoomId,
  canonicalSelectedThreadId,
  navigateRoomThread,
}: {
  entry: RecentThreadItem;
  room: Room;
  threadTagSnapshots: Map<string, Map<string, ThreadTagSnapshot>>;
  selectedRoomId?: string | undefined;
  canonicalSelectedThreadId?: string | undefined;
  navigateRoomThread: (roomId: string, threadId: string) => void;
}): MindroomCommandPaletteThreadItem => {
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

  return toCommandPaletteThreadItem(viewModel, () => navigateRoomThread(room.roomId, threadRootId));
};

const buildSdkThreadItem = ({
  room,
  threadId,
  threadTagSnapshots,
  selectedRoomId,
  canonicalSelectedThreadId,
  navigateRoomThread,
}: {
  room: Room;
  threadId: string;
  threadTagSnapshots: Map<string, Map<string, ThreadTagSnapshot>>;
  selectedRoomId?: string | undefined;
  canonicalSelectedThreadId?: string | undefined;
  navigateRoomThread: (roomId: string, threadId: string) => void;
}): MindroomCommandPaletteThreadItem => {
  const threadRootId = resolveCanonicalThreadRootId(room, threadId) ?? threadId;
  const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadRootId);
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

  return toCommandPaletteThreadItem(viewModel, () => navigateRoomThread(room.roomId, threadRootId));
};

export const useMindroomCommandPaletteThreadItems = ({
  mx,
  myUserId,
  allJoinedRoomIds,
  getRoom,
  selectedRoom,
  selectedRoomId,
  currentThreadId,
  navigateRoomThread,
}: UseMindroomCommandPaletteThreadItemsOptions): {
  currentThreadRootId: string | undefined;
  currentThreadResolved: boolean;
  setCurrentThreadResolved: (resolved: boolean) => void;
  threadItems: readonly MindroomCommandPaletteThreadItem[];
} => {
  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(myUserId), [myUserId]);
  const recentThreads = useAtomValue(recentThreadsAtom);
  const currentThreadRootId = useMemo(
    () => resolveCommandPaletteCurrentThreadRootId(selectedRoom, currentThreadId),
    [currentThreadId, selectedRoom]
  );

  const threadTagSnapshots = useMemo(() => {
    const snapshots = new Map<string, Map<string, ThreadTagSnapshot>>();

    allJoinedRoomIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      snapshots.set(room.roomId, getMindroomThreadTagSnapshots(room));
    });

    return snapshots;
  }, [allJoinedRoomIds, getRoom]);

  const currentThreadResolved = useMemo(() => {
    if (!selectedRoom || !currentThreadRootId) return false;

    return (
      threadTagSnapshots.get(selectedRoom.roomId)?.get(currentThreadRootId)?.isResolved ?? false
    );
  }, [currentThreadRootId, selectedRoom, threadTagSnapshots]);

  const setCurrentThreadResolved = useCallback(
    (resolved: boolean) => {
      if (!selectedRoom || !currentThreadRootId) return;

      const rootEvent = getValidThreadRootEvent(selectedRoom, currentThreadRootId);
      const threadRootId = rootEvent?.getId();
      if (!threadRootId) return;

      fireAndForget(
        mx.sendStateEvent(
          selectedRoom.roomId,
          MINDROOM_THREAD_TAGS_EVENT as any,
          resolved ? buildPerTagEventContent(myUserId) : {},
          buildPerTagStateKey(threadRootId, RESOLVED_TAG)
        )
      );
    },
    [currentThreadRootId, mx, myUserId, selectedRoom]
  );

  const threadItems = useMemo(() => {
    const items = new Map<string, MindroomCommandPaletteThreadItem>();

    const upsert = (item: MindroomCommandPaletteThreadItem) => {
      const existing = items.get(item.id);
      if (!existing) {
        items.set(item.id, item);
        return;
      }

      items.set(item.id, {
        ...mergeCommandPaletteThreadItems(existing, item),
        onSelect: item.onSelect,
      });
    };

    recentThreads.forEach((entry) => {
      const room = getRoom(entry.roomId);
      if (!room) return;

      upsert(
        buildRecentThreadItem({
          entry,
          room,
          threadTagSnapshots,
          selectedRoomId,
          canonicalSelectedThreadId: currentThreadRootId,
          navigateRoomThread,
        })
      );
    });

    allJoinedRoomIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room || typeof room.getThreads !== 'function') return;

      room.getThreads().forEach((thread) => {
        upsert(
          buildSdkThreadItem({
            room,
            threadId: thread.id,
            threadTagSnapshots,
            selectedRoomId,
            canonicalSelectedThreadId: currentThreadRootId,
            navigateRoomThread,
          })
        );
      });
    });

    return Array.from(items.values());
  }, [
    allJoinedRoomIds,
    currentThreadRootId,
    getRoom,
    navigateRoomThread,
    recentThreads,
    selectedRoomId,
    threadTagSnapshots,
  ]);

  return {
    currentThreadRootId,
    currentThreadResolved,
    setCurrentThreadResolved,
    threadItems,
  };
};
