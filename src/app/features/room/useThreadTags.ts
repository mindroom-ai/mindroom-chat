import { useEffect, useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useStateEvents } from '../../hooks/useStateEvents';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import {
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  parseThreadTagsContent,
  type TagMetadata,
  type ThreadTagsContent,
} from './threadTags';
import {
  clearPendingThreadTagsContent,
  getPendingThreadTagsContent,
  sameThreadTagsContent,
  usePendingThreadTagsVersion,
} from './threadTagPending';

export type UseThreadTagsResult = {
  /** Full parsed tag map */
  tags: Record<string, TagMetadata>;
  /** Tag names excluding the reserved "resolved" tag */
  displayTags: string[];
  /** Whether the thread has the reserved "resolved" tag */
  isResolved: boolean;
  /** Whether the current user has permission to edit thread tags */
  canEdit: boolean;
  /** Tag names used across all threads in this room, minus current tags and "resolved" */
  availableTags: string[];
  /** The raw parsed content for use by mutation hooks */
  content: ThreadTagsContent;
};

/**
 * Read hook for thread tags on a specific thread.
 *
 * Subscribes to state event changes for the thread's tag state key
 * and all thread tag events in the room (for suggestions).
 */
export const useThreadTags = (
  room: Room,
  threadRootId: string | undefined
): UseThreadTagsResult => {
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  // Subscribe to this thread's tag state event
  const tagEvent = useStateEvent(
    room,
    StateEvent.ThreadTags,
    threadRootId ?? ''
  );

  // Subscribe to ALL thread tag events for suggestion collection
  const allTagEvents = useStateEvents(room, StateEvent.ThreadTags);
  const pVersion = usePendingThreadTagsVersion();

  const actualContent = useMemo(
    () => parseThreadTagsContent(tagEvent?.getContent()),
    [tagEvent]
  );
  const pendingContent = useMemo(
    () => (threadRootId ? getPendingThreadTagsContent(room.roomId, threadRootId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, threadRootId, pVersion]
  );
  const content = pendingContent ?? actualContent;

  useEffect(() => {
    if (!threadRootId || !pendingContent) return;
    if (sameThreadTagsContent(actualContent, pendingContent)) {
      clearPendingThreadTagsContent(room.roomId, threadRootId);
    }
  }, [actualContent, pendingContent, room.roomId, threadRootId]);

  const displayTags = useMemo(() => getDisplayTags(content), [content]);

  const resolved = useMemo(() => isThreadResolved(content), [content]);

  const canEdit = useMemo(
    () => permissions.stateEvent(StateEvent.ThreadTags, mx.getSafeUserId()),
    [permissions, mx]
  );

  const allTagContents = useMemo(
    () => allTagEvents.map((evt) => parseThreadTagsContent(evt.getContent())),
    [allTagEvents]
  );

  const availableTags = useMemo(
    () => collectAvailableTags(allTagContents, content.tags),
    [allTagContents, content.tags]
  );

  return {
    tags: content.tags,
    displayTags,
    isResolved: resolved,
    canEdit,
    availableTags,
    content,
  };
};
