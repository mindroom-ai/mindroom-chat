import { useEffect, useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { useStateEvents } from '../../matrix/hooks/useStateEvents';
import {
  aggregateThreadTagEvents,
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  SNOOZED_TAG,
  type TagMetadata,
  type ThreadTagsContent,
} from '../../event-store/threads/threadTags';
import {
  settlePendingThreadTags,
  usePendingThreadTagsVersion,
  withPendingThreadTags,
} from './threadTagPending';
import { usePinnedEventIds } from '../../event-store/threads/useThreadPinning';
import { parseThreadSnooze } from '../../event-store/threads/threadSnooze';

type ThreadTagsState = {
  /** Every tag on the thread, `resolved` included. */
  tags: Record<string, TagMetadata>;
  /** Tags to show as pills: everything but `resolved`. */
  displayTags: string[];
  isResolved: boolean;
  /** The `until` of the thread's snooze, past or not; undefined without a valid one. */
  snoozedUntilTs?: number;
  /** Whether the user may write the room's thread tag state. */
  canEdit: boolean;
  /** Tags used on other threads of the room, offered as suggestions. */
  availableTags: string[];
};

const EMPTY_CONTENT: ThreadTagsContent = { tags: {} };

/**
 * Tags of one thread, from the room's `com.mindroom.thread.tags` state. A tag change the user
 * just made shows at once, on top of the room state, so tags others set meanwhile show too; it
 * leaves once the room state shows it. A pinned thread never reads as resolved.
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
  const content = useMemo(
    () =>
      threadRootId ? withPendingThreadTags(room.roomId, threadRootId, liveContent) : liveContent,
    // The pending store is external; its version is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, threadRootId, liveContent, pendingVersion]
  );

  useEffect(() => {
    if (threadRootId) settlePendingThreadTags(room.roomId, threadRootId, liveContent);
  }, [liveContent, pendingVersion, room.roomId, threadRootId]);
  const pinned = !!threadRootId && pinnedEventIds.includes(threadRootId);
  const canEdit = permissions.stateEvent(MINDROOM_THREAD_TAGS_EVENT, myUserId);

  return useMemo(
    () => ({
      tags: content.tags,
      displayTags: getDisplayTags(content),
      isResolved: isThreadResolved(content, pinned),
      snoozedUntilTs: parseThreadSnooze(content.tags[SNOOZED_TAG])?.untilTs,
      canEdit,
      availableTags: collectAvailableTags(
        [...aggregated].filter(([rootId]) => rootId !== threadRootId).map(([, value]) => value),
        content.tags
      ),
    }),
    [aggregated, canEdit, content, pinned, threadRootId]
  );
};
