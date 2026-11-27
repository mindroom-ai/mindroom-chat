import { EventTimeline, MsgType, RelationType, type MatrixClient, type Room } from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { getStateEvent } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import { isThreadPinned } from './threadPinning';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import {
  clearPendingThreadTag,
  hasPendingThreadTag,
  setPendingThreadTag,
} from './threadTagPending';
import { getRoomThreadTagSnapshotMap } from './threadTagSnapshots';
import {
  aggregateThreadTagEvents,
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  normalizeTagName,
  RESOLVED_TAG,
  SNOOZED_TAG,
  type TagMetadata,
} from './threadTags';

export type ThreadTagWriteExtra = {
  note?: string;
  data?: Record<string, unknown>;
};

export type ResolvedThreadReplySnapshot = {
  threadRootId: string;
  resolvedTs: number | undefined;
  resolvedTag: TagMetadata;
};

/** Whether `userId` may write `com.mindroom.thread.tags` state events in `room`. */
export const canWriteThreadTags = (room: Room, userId: string): boolean => {
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const powerLevels = getPowersLevelFromMatrixEvent(
    getStateEvent(room, StateEvent.RoomPowerLevels)
  );
  return getRoomPermissionsAPI(creators, powerLevels).stateEvent(
    MINDROOM_THREAD_TAGS_EVENT,
    userId
  );
};

/**
 * Sends a single per-tag state event for `threadRootId` in `room`, publishing an optimistic
 * pending tag immediately and rolling it back if the write fails.
 */
export async function writeThreadTag(
  mx: MatrixClient,
  room: Room,
  threadRootId: string,
  tagName: string,
  present: boolean,
  extra: ThreadTagWriteExtra = {}
): Promise<void> {
  const userId = mx.getSafeUserId();
  const validThreadRootId = getResolvableThreadRootEvent(room, threadRootId)?.getId();
  if (!validThreadRootId) {
    throw new Error('Thread tags are only available for known thread roots.');
  }

  const stateKey = buildPerTagStateKey(validThreadRootId, tagName);
  const pinned = () => isThreadPinned(room, validThreadRootId);
  if (stateKey === buildPerTagStateKey(validThreadRootId, RESOLVED_TAG) && pinned()) {
    throw new Error('Pinned threads cannot be resolved.');
  }
  // A snooze set before the pin may still be lifted.
  if (present && stateKey === buildPerTagStateKey(validThreadRootId, SNOOZED_TAG) && pinned()) {
    throw new Error('Pinned threads cannot be snoozed.');
  }
  const content = present
    ? buildPerTagEventContent(userId, extra.note, extra.data, new Date().toISOString())
    : undefined;
  const pending: [rootId: string, tag: string] = [validThreadRootId, normalizeTagName(tagName)];
  // The pending tag is the content being sent: its author, time, note and data.
  setPendingThreadTag(room.roomId, ...pending, content ?? null);
  try {
    await mx.sendStateEvent(
      room.roomId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MINDROOM_THREAD_TAGS_EVENT as any,
      content ?? {},
      stateKey
    );
  } catch (err) {
    clearPendingThreadTag(room.roomId, ...pending);
    throw err;
  }
}

/**
 * Resolves or reopens a thread in `room`, clearing any `snoozed` tag when resolving so reopening
 * later does not restore an old snooze.
 */
export async function setThreadResolved(
  mx: MatrixClient,
  room: Room,
  threadRootId: string,
  resolved: boolean
): Promise<void> {
  await writeThreadTag(mx, room, threadRootId, RESOLVED_TAG, resolved);
  if (!resolved) return;
  // Resolving ends a snooze, as the backend's resolve does; left set, reopening would bring
  // it back and the backend would still clear it at its time.
  const events =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT) ?? [];
  if (aggregateThreadTagEvents(events).get(threadRootId)?.tags[SNOOZED_TAG]) {
    await writeThreadTag(mx, room, threadRootId, SNOOZED_TAG, false);
  }
}

/** Clears any `snoozed` tag on `threadRootId` in `room`. */
export const unsnoozeThread = (mx: MatrixClient, room: Room, threadRootId: string): Promise<void> =>
  writeThreadTag(mx, room, threadRootId, SNOOZED_TAG, false);

const getThreadReplyRootId = (content: unknown): string | undefined => {
  if (!content || typeof content !== 'object') return undefined;
  const { msgtype, 'm.relates_to': relation } = content as {
    msgtype?: unknown;
    'm.relates_to'?: unknown;
  };
  if (typeof msgtype === 'string' && matchesEnum(msgtype, MsgType.Notice)) return undefined;
  if (!relation || typeof relation !== 'object') return undefined;
  const { rel_type: relType, event_id: eventId } = relation as {
    rel_type?: unknown;
    event_id?: unknown;
  };
  return typeof relType === 'string' &&
    matchesEnum(relType, RelationType.Thread) &&
    typeof eventId === 'string' &&
    eventId.length > 0
    ? eventId
    : undefined;
};

const sameResolvedTag = (left: TagMetadata, right: TagMetadata): boolean =>
  left === right ||
  (left.set_by === right.set_by &&
    left.set_at === right.set_at &&
    left.note === right.note &&
    JSON.stringify(left.data) === JSON.stringify(right.data));

/**
 * Captures the resolved-tag snapshot of a thread reply target before send, or `undefined` when
 * the message is an `m.notice` or not an `m.thread` reply, or the thread is not resolved, is
 * pinned, or already has a pending `resolved` write. Never throws.
 */
export const captureResolvedThreadBeforeReply = (
  room: Room,
  content: unknown
): ResolvedThreadReplySnapshot | undefined => {
  try {
    const threadRootId = getThreadReplyRootId(content);
    if (
      !threadRootId ||
      isThreadPinned(room, threadRootId) ||
      hasPendingThreadTag(room.roomId, threadRootId, RESOLVED_TAG)
    ) {
      return undefined;
    }
    const snapshot = getRoomThreadTagSnapshotMap(room).get(threadRootId);
    const resolvedTag = snapshot?.isResolved ? snapshot.content.tags[RESOLVED_TAG] : undefined;
    if (!snapshot || !resolvedTag) return undefined;
    return { threadRootId, resolvedTs: snapshot.resolvedTs, resolvedTag };
  } catch {
    return undefined;
  }
};

/**
 * Best-effort reopens a thread after a local reply send succeeds, if it is still resolved with the
 * same record captured before send, unpinned, has no pending `resolved` write, and the user may
 * write thread tags. Never throws or affects message delivery.
 */
export const reopenResolvedThreadAfterReply = async (
  mx: MatrixClient,
  room: Room,
  beforeSend: ResolvedThreadReplySnapshot | undefined
): Promise<void> => {
  if (!beforeSend) return;
  try {
    const { threadRootId, resolvedTs, resolvedTag } = beforeSend;
    const current = getRoomThreadTagSnapshotMap(room).get(threadRootId);
    const currentResolved = current?.isResolved ? current.content.tags[RESOLVED_TAG] : undefined;
    if (
      !current ||
      !currentResolved ||
      current.resolvedTs !== resolvedTs ||
      !sameResolvedTag(resolvedTag, currentResolved)
    ) {
      return;
    }
    if (isThreadPinned(room, threadRootId)) return;
    if (hasPendingThreadTag(room.roomId, threadRootId, RESOLVED_TAG)) return;
    const userId = mx.getUserId?.() ?? mx.getSafeUserId?.();
    if (!userId || !canWriteThreadTags(room, userId)) return;
    await setThreadResolved(mx, room, threadRootId, false);
  } catch {
    // Best-effort: a tag lookup or write failure must never fail or retry message delivery.
  }
};
