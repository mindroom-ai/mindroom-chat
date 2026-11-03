import { useEffect, useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useStateEvents } from './useStateEvents';
import {
  aggregateThreadTagEvents,
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  type TagMetadata,
  type ThreadTagsContent,
} from './threadTags';
import {
  clearPendingThreadTagsContent,
  getPendingThreadTagsContent,
  sameThreadTagsContent,
  usePendingThreadTagsVersion,
} from './threadTagPending';
import { usePinnedEventIds } from './useThreadPinning';

export type ThreadTagsState = {
  /** Every tag on the thread, `resolved` included. */
  tags: Record<string, TagMetadata>;
  /** Tags to show as pills: everything but `resolved`. */
  displayTags: string[];
  isResolved: boolean;
  /** Whether the user may write the room's thread tag state. */
  canEdit: boolean;
  /** Tags used on other threads of the room, offered as suggestions. */
  availableTags: string[];
};

const EMPTY_CONTENT: ThreadTagsContent = { tags: {} };

/**
 * Tags of one thread, from the room's `com.mindroom.thread.tags` state. A tag change the user
 * just made shows at once and gives way to the room state when the state catches up. A pinned
 * thread never reads as resolved.
 */
export const useThreadTags = (room: Room, threadRootId?: string): ThreadTagsState => {
  const myUserId = useMatrixClient().getSafeUserId();
  const roomPowerLevels = usePowerLevelsContext();
  const permissions = useRoomPermissions(useRoomCreators(room), roomPowerLevels);
  const events = useStateEvents(room, MINDROOM_THREAD_TAGS_EVENT);
  const pendingVersion = usePendingThreadTagsVersion();
  const pinnedEventIds = usePinnedEventIds(room);

  const aggregated = useMemo(() => aggregateThreadTagEvents(events), [events]);
  const liveContent = (threadRootId && aggregated.get(threadRootId)) || EMPTY_CONTENT;
  const pendingContent = useMemo(
    () => (threadRootId ? getPendingThreadTagsContent(room.roomId, threadRootId) : undefined),
    // The pending store is external; its version is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, threadRootId, pendingVersion]
  );

  useEffect(() => {
    if (!threadRootId || !pendingContent) return;
    if (sameThreadTagsContent(liveContent, pendingContent)) {
      clearPendingThreadTagsContent(room.roomId, threadRootId);
    }
  }, [liveContent, pendingContent, room.roomId, threadRootId]);

  const content = pendingContent ?? liveContent;
  const pinned = !!threadRootId && pinnedEventIds.includes(threadRootId);
  const canEdit = permissions.stateEvent(MINDROOM_THREAD_TAGS_EVENT, myUserId);

  return useMemo(
    () => ({
      tags: content.tags,
      displayTags: getDisplayTags(content),
      isResolved: isThreadResolved(content, pinned),
      canEdit,
      availableTags: collectAvailableTags(
        [...aggregated].filter(([rootId]) => rootId !== threadRootId).map(([, value]) => value),
        content.tags
      ),
    }),
    [aggregated, canEdit, content, pinned, threadRootId]
  );
};
