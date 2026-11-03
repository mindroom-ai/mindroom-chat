import {
  EventTimeline,
  EventType,
  RelationType,
  type EventTimelineSet,
  type IContent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { MessageEvent, MsgType, RoomType, StateEvent } from '../../types/matrix/room';
import { getShallowSerializedReplacementEvent, isSameSenderEditEvent } from './editEvent';
import { isRecord } from './isRecord';
import { mxcUrlToHttp } from './mediaUrl';

/** A room's current state event of `eventType` (and `stateKey`), if the client has it. */
export const getStateEvent = (
  room: Room,










  mx.getAccountData(eventType as never) ?? undefined;

const getRoomType = (room: Room): string | undefined => {
  const type = getStateEvent(room, StateEvent.RoomCreate)?.getContent()?.type;
  return typeof type === 'string' ? type : undefined;
};

export const isSpace = (room: Room | null | undefined): boolean =>
  !!room && getRoomType(room) === RoomType.Space;

/** The room that holds the homeserver's shared emoji pack; it is never listed as a room. */
export const isMindroomEmojiRoom = (room: Room | null | undefined): boolean =>
  !!room && getRoomType(room) === RoomType.MindroomEmoji;

/** A room people chat in: not a space and not the server emoji room. Call rooms count. */
export const isRoom = (room: Room | null | undefined): boolean => {
  if (!room) return false;
  const type = getRoomType(room);
  return type !== RoomType.Space && type !== RoomType.MindroomEmoji;
};

export const getMemberDisplayName = (room: Room, userId: string): string | undefined => {
  const name = room.getMember(userId)?.rawDisplayName;
  return name && name !== userId ? name : undefined;
};

export const getMemberAvatarMxc = (room: Room, userId: string): string | undefined =>
  room.getMember(userId)?.getMxcAvatarUrl() ?? undefined;

export const getRoomAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  size = 32,
  useAuthentication = false
): string | undefined => {
  const mxc = room.getMxcAvatarUrl();
  return mxc
    ? mxcUrlToHttp(mx, mxc, useAuthentication, size, size, 'crop') ?? undefined
    : undefined;
};

/** A direct room shows the other person's avatar, falling back to the room's own. */
export const getDirectRoomAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  size = 32,
  useAuthentication = false
): string | undefined => {
  const mxc = room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? room.getMxcAvatarUrl();
  return mxc
    ? mxcUrlToHttp(mx, mxc, useAuthentication, size, size, 'crop') ?? undefined
    : undefined;
};

/** Whether our pending invite to the room is marked as a direct chat (`is_direct`). */
export const isDirectInvite = (room: Room, myUserId: string): boolean =>
  room.getMember(myUserId)?.events.member?.getContent().is_direct === true;

const relationType = (mEvent: MatrixEvent): string | undefined =>
  mEvent.getRelation()?.rel_type ?? undefined;

/** Reactions and edits annotate other events; timelines and unread counts skip them. */
export const reactionOrEditEvent = (mEvent: MatrixEvent): boolean => {
  if (mEvent.getType() === EventType.Reaction) return true;
  const relType = relationType(mEvent);
  return relType === RelationType.Annotation || relType === RelationType.Replace;
};

const VISIBLE_REFERENCE_TYPES = new Set<string>([MessageEvent.RoomMessage, MessageEvent.Sticker]);

/**
 * A reference that is data rather than a message, such as a canvas's shared state pointing at the
 * canvas. A message that references another event is still a message; an encrypted reference
 * that is not (or cannot be) decrypted is hidden, since it is usually such data.
 */
export const isHiddenReferenceEvent = (mEvent: MatrixEvent): boolean =>
  relationType(mEvent) === RelationType.Reference &&
  (!VISIBLE_REFERENCE_TYPES.has(mEvent.getType()) || !!mEvent.isDecryptionFailure?.());

/** Whether a member event changed the membership, rather than only the name or avatar. */
export const isMembershipChanged = (mEvent: MatrixEvent): boolean => {
  const content = mEvent.getContent();
  const previous = mEvent.getPrevContent();
  return content.membership !== previous.membership || content.reason !== previous.reason;
};

/** Whether `a` comes after `b`: a later server timestamp, or the greater event ID on a tie. */
export const isEventOrderedAfter = (a: MatrixEvent, b: MatrixEvent): boolean => {
  const aTs = a.getTs();
  const bTs = b.getTs();
  if (aTs !== bTs) return aTs > bTs;
  return (a.getId() ?? '') > (b.getId() ?? '');
};

/**
 * The newest of the candidate replacements by the target's sender, by timestamp and then event
 * ID. When both tie, the earlier candidate wins, so the result does not flip between equal copies.
 */
export const getLatestEdit = (
  targetEvent: MatrixEvent,
  editEvents: readonly MatrixEvent[]
): MatrixEvent | undefined =>
  editEvents.reduce<MatrixEvent | undefined>((latest, candidate) => {
    if (!isSameSenderEditEvent(targetEvent, candidate)) return latest;
    return !latest || isEventOrderedAfter(candidate, latest) ? candidate : latest;
  }, undefined);

// Keys MindRoom puts on its messages (stream status, tool trace, run metadata, extras). The
// long-text marker describes how one edit's own content is stored, so it never carries over.
const isMindroomMetadataKey = (key: string): boolean =>
  (key.startsWith('io.mindroom.') || key.startsWith('com.mindroom.')) &&
  key !== 'io.mindroom.long_text';

const getNewContent = (edit: MatrixEvent): Record<string, unknown> | undefined => {
  const newContent = edit.getContent()['m.new_content'];
  return isRecord(newContent) ? newContent : undefined;
};

const metadataOf = (edit: MatrixEvent, key: string): unknown => {
  const newContent = getNewContent(edit);
  if (newContent && newContent[key] !== undefined) return newContent[key];
  return edit.getContent()[key];
};

/**
 * A large streamed reply may leave its tool trace in an earlier edit (later ones carry it only in
 * a sidecar), so the newest edit borrows MindRoom metadata it lacks from the sender's older edits.
 */
const fillMetadataFromOlderEdits = (latest: MatrixEvent, older: MatrixEvent[]): void => {
  const newContent = getNewContent(latest);
  if (!newContent || older.length === 0) return;
  const wrapper = latest.getContent();
  const keys = new Set(
    older.flatMap((edit) => [
      ...Object.keys(edit.getContent()),
      ...Object.keys(getNewContent(edit) ?? {}),
    ])
  );
  keys.forEach((key) => {
    if (!isMindroomMetadataKey(key)) return;
    if (newContent[key] !== undefined || wrapper[key] !== undefined) return;
    const source = older.find((edit) => metadataOf(edit, key) !== undefined);
    if (source) newContent[key] = metadataOf(source, key);
  });
};

const getRelationEdits = (
  eventId: string,
  mEvent: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined
): MatrixEvent[] => {
  const eventTypes = new Set<string>([EventType.RoomMessage, mEvent.getType()]);
  return [...eventTypes].flatMap(
    (eventType) =>
      timelineSet?.relations
        ?.getChildEventsForEvent(eventId, RelationType.Replace, eventType)
        ?.getRelations() ?? []
  );
};

/**
 * The edit to show for `mEvent`: the newest replacement by its sender among the SDK's applied
 * replacement, the relation edits in `timelineSet`, and the replacement bundled by the server.
 * Pass `serializedReplacementCandidate` to reuse a bundle already read from the event.
 */
export const getEditedEvent = (
  eventId: string,
  mEvent: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined,
  serializedReplacementCandidate?: MatrixEvent
): MatrixEvent | undefined => {
  const candidates = [
    mEvent.replacingEvent() ?? undefined,
    ...getRelationEdits(eventId, mEvent, timelineSet),
    serializedReplacementCandidate ?? getShallowSerializedReplacementEvent(mEvent),
  ].filter(
    (candidate): candidate is MatrixEvent =>
      isSameSenderEditEvent(mEvent, candidate) && !candidate.isRedacted()
  );

  const latest = getLatestEdit(mEvent, candidates);
  if (!latest) return undefined;

  const older = candidates
    .filter((candidate) => candidate !== latest && candidate.getId() !== latest.getId())
    .sort((a, b) => (isEventOrderedAfter(a, b) ? -1 : 1));
  fillMetadataFromOlderEdits(latest, older);
  return latest;
};

/**
 * The content to render: the edit's `m.new_content` with the MindRoom metadata the edit carries
 * at its top level, or the event's own content without an edit by its sender.
 */
export const getLatestMessageContent = (
  targetEvent: MatrixEvent,
  editedEvent: MatrixEvent | undefined
): IContent => {
  if (!editedEvent || !isSameSenderEditEvent(targetEvent, editedEvent)) {
    return targetEvent.getContent();
  }
  const newContent = getNewContent(editedEvent);
  if (!newContent) return targetEvent.getContent();

  const content: IContent = { ...newContent };
  Object.entries(editedEvent.getContent()).forEach(([key, value]) => {
    if (isMindroomMetadataKey(key) && content[key] === undefined) content[key] = value;
  });
  return content;
};

export const getEventReactions = (
  timelineSet: Pick<EventTimelineSet, 'relations'>,
  eventId: string
): Relations | undefined =>
  timelineSet.relations?.getChildEventsForEvent(
    eventId,
    RelationType.Annotation,
    EventType.Reaction
  );

const isLongTextFile = (content: Record<string, unknown>): boolean =>
  content.msgtype === MsgType.File && isRecord(content['io.mindroom.long_text']);

const EDITABLE_MSGTYPES = new Set<string>([MsgType.Text, MsgType.Emote, MsgType.Notice]);

/** Whether we may edit the event: our own text message, including one sent as long text. */
export const canEditEvent = (mx: MatrixClient, mEvent: MatrixEvent): boolean => {
  if (mEvent.getSender() !== mx.getUserId() || mEvent.isRedacted()) return false;
  if (mEvent.getType() !== MessageEvent.RoomMessage) return false;
  const relation = mEvent.getRelation();
  if (relation && relation.rel_type !== RelationType.Thread) return false;
  const content = mEvent.getContent();
  return (
    (typeof content.msgtype === 'string' && EDITABLE_MSGTYPES.has(content.msgtype)) ||
    isLongTextFile(content)
  );
};

const MINDROOM_TOOL_APPROVAL_EVENT = 'io.mindroom.tool_approval';

const UNREAD_EVENT_TYPES = new Set<string>([



  MINDROOM_TOOL_APPROVAL_EVENT,
]);

// What counts towards a room's unread dot: messages in the main timeline by someone else.
const isUnreadWorthy = (mEvent: MatrixEvent): boolean =>
  UNREAD_EVENT_TYPES.has(mEvent.getType()) &&
  mEvent.getStateKey() === undefined &&
  !mEvent.isRedacted() &&
  relationType(mEvent) !== RelationType.Thread &&
  !reactionOrEditEvent(mEvent) &&
  !isHiddenReferenceEvent(mEvent);

/**
 * Whether the room has a message we have not read: walking back from the newest event, a
 * message by someone else before our read position or our own last message.
 */






  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (readUpToId && event.getId() === readUpToId) return false;
    if (event.getSender() === userId) {
      if (isUnreadWorthy(event)) return false;
    } else if (isUnreadWorthy(event)) {
      return true;
    }
  }
  return false;
};

export const getUnreadInfo = (room: Room) => ({
  roomId: room.roomId,
  highlight: room.getUnreadNotificationCount('highlight' as never) ?? 0,
  total: room.getUnreadNotificationCount('total' as never) ?? 0,
});

/** Decrypts every encrypted event of the timeline that has not been decrypted yet. */
export const decryptAllTimelineEvent = async (
  mx: MatrixClient,
  timeline: EventTimeline



  await Promise.all(
    timeline
      .getEvents()
      .filter((event) => event.isEncrypted() && event.shouldAttemptDecryption())
      .map((event) => mx.decryptEventIfNeeded(event))
  );
};

/**
 * Removes a reply fallback (MSC2781) from the start of a body: quote lines starting with `> <`
 * for the sender, ended by an empty line. Anything else is left as it is. Linear in the length.
 */
export const trimReplyFromBody = (body: string): string => {
  if (!body.startsWith('> <')) return body;
  const firstLineEnd = body.indexOf('\n');
  const firstLine = firstLineEnd < 0 ? body : body.slice(0, firstLineEnd);
  if (firstLine.indexOf('>', 3) < 0) return body;

  let lineStart = 0;
  while (lineStart < body.length) {
    const lineEnd = body.indexOf('\n', lineStart);
    if (lineEnd < 0) return body;
    if (lineEnd === lineStart) return body.slice(lineEnd + 1);
    if (body[lineStart] !== '>') return body;
    lineStart = lineEnd + 1;
  }
  return body;
};

/** The replacement relations of an event, for listing its edit history. */
export const getEventEdits = (
  timelineSet: Pick<EventTimelineSet, 'relations'>,
  eventId: string,
  eventType: string = EventType.RoomMessage
): Relations | undefined =>
  timelineSet.relations?.getChildEventsForEvent(eventId, RelationType.Replace, eventType);

/** The newest event of the timeline we may edit, for editing the last message with Up. */
export const getLatestEditableEvt = (





    const event = events[index];
    if (!reactionOrEditEvent(event) && canEdit(event)) return event;
  }








    rel_type: RelationType.Annotation,
  },
  ...(shortcode ? { shortcode } : {}),
});

/** The text a member list search matches: the user ID for `@` queries, else the name. */
export const getMemberSearchStr = (
  member: Pick<RoomMember, 'userId' | 'rawDisplayName'>,
  query: string,
  mxIdToName?: (userId: string) => string
): string => {
  if (query.startsWith('@')) return member.userId;
  const name =
    member.rawDisplayName && member.rawDisplayName !== member.userId
      ? member.rawDisplayName
      : mxIdToName?.(member.userId) ?? member.userId;
  return name;
};

/** Of the spaces that contain a room, the one to open it in: a joined one first. */
export const guessPerfectParent = (
  mx: MatrixClient,
  roomId: string,
  parents: readonly string[] | Set<string> | undefined
): string | undefined => {
  const candidates = [...(parents ?? [])].filter((parentId) => parentId !== roomId);
  return (
    candidates.find((parentId) => mx.getRoom(parentId)?.getMyMembership() === 'join') ??
    candidates[0]
  );
};
