import {
  Direction,
  EventTimeline,
  EventType,
  NotificationCountType,
  RelationType,
  type EventTimelineSet,
  type IContent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { removeHiddenChars } from 'matrix-js-sdk/lib/utils';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { Membership, MessageEvent, MsgType, RoomType, StateEvent } from './types/room';
import { getMxIdLocalPart } from './matrix';
import { getShallowSerializedReplacementEvent, isSameSenderEditEvent } from './editEvent';
import { copyResolvedEditMetadata } from './protocol/editMetadata';
import { getAppliedEdit, isUsableEdit } from './protocol/untrustedContent';
import { MINDROOM_TOOL_APPROVAL_EVENT } from './protocol/toolApproval';
import { isRecord } from '../lib/isRecord';
import { mxcUrlToHttp } from './mediaUrl';
import { matchesEnum } from '../lib/matchesEnum';
import { getMainTimelineReadTs, isMainTimelineMessageUnread } from './mainTimelineRead';
import { countSeenThreadRootsAfter } from './seenThreadRoots';
import { isUnreadableYet } from './decryptionWaits';
import { getSyncedEdit } from './client/syncedEdits';

/** A room's current state event of `eventType` (and `stateKey`), if the client has it. */
export const getStateEvent = (room: Room, type: string, stateKey = ''): MatrixEvent | undefined => {
  const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  return state?.getStateEvents(type, stateKey) ?? undefined;
};

/** The account data event of `eventType`, if the client has it. */
export const getAccountData = (mx: MatrixClient, eventType: string): MatrixEvent | undefined =>
  mx.getAccountData(eventType as never) ?? undefined;

const getRoomType = (room: Room): string | undefined => {
  const type = getStateEvent(room, StateEvent.RoomCreate)?.getContent()?.type;
  return typeof type === 'string' ? type : undefined;
};

export const isSpace = (room: Room | null | undefined): boolean =>
  !!room && getRoomType(room) === RoomType.Space;

/** The room that holds the homeserver's shared emoji pack; it is never listed as a room. */
export const isEmojiRoom = (room: Room | null | undefined): boolean =>
  !!room && getRoomType(room) === RoomType.MindroomEmoji;

/** A room people chat in: not a space and not the server emoji room. Call rooms count. */
export const isRoom = (room: Room | null | undefined): boolean => {
  if (!room) return false;
  const type = getRoomType(room);
  return type !== RoomType.Space && type !== RoomType.MindroomEmoji;
};

/**
 * Characters that change how a name reads without showing themselves: soft hyphens, zero-width
 * spaces, word joiners and invisible operators, byte order marks, fillers, and direction controls
 * (which could also reorder the user ID shown after a name). Zero-width joiners and non-joiners
 * are not among them: emoji sequences and Persian names need them.
 */
const NAME_DISGUISES =
  /[\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g;

/** A name that could be a user ID's localpart (`sam` of `@sam:example.org`). */
const LOCALPART_SHAPE = /^[a-z0-9._=\-/+]+$/;

/**
 * A name without the characters above, for a place that shows the user ID beside it; undefined
 * when it shows nothing.
 */
export const withoutNameDisguises = (name: string): string | undefined => {
  const shown = name.replace(NAME_DISGUISES, '');
  return shown.trim() ? shown : undefined;
};

/** A member's display name without the characters above; undefined when it shows nothing. */
const shownName = (member: RoomMember): string | undefined => {
  // The SDK's raw name lacks direction overrides, and is the user ID when it would show nothing.
  const raw = member.rawDisplayName;
  if (!raw || raw === member.userId) return undefined;
  return withoutNameDisguises(raw);
};

/**
 * Whether `name` is how another member of `room` shows: one who is in or invited to the room and,
 * having no name of their own, shows as their user ID's localpart. The clash index below holds
 * display names only.
 */
const takesNamelessLocalpart = (room: Room, member: RoomMember, name: string): boolean =>
  LOCALPART_SHAPE.test(name) &&
  room
    .getMembers()
    .some(
      (other) =>
        other.userId !== member.userId &&
        (matchesEnum(other.membership, Membership.Join) ||
          matchesEnum(other.membership, Membership.Invite)) &&
        getMxIdLocalPart(other.userId) === name &&
        shownName(other) === undefined
    );

/** Each member's shown name as names are compared, kept while their display name stays. */
const comparableNames = new WeakMap<RoomMember, { raw: string; name: string }>();

/**
 * A member's shown name as matrix-js-sdk compares names (`removeHiddenChars`: hidden characters
 * out, look-alike letters folded); empty without a name.
 */
const comparableName = (member: RoomMember): string => {
  const cached = comparableNames.get(member);
  if (cached && cached.raw === member.rawDisplayName) return cached.name;
  const shown = shownName(member);
  const name = shown === undefined ? '' : removeHiddenChars(shown);
  comparableNames.set(member, { raw: member.rawDisplayName, name });
  return name;
};

/**
 * Whether a member of `room` other than `userId` shows a name that reads like `name`, among
 * everyone but members who left or were banned. Decided from the room's members as they are now,
 * because the SDK's own clash check (`RoomMember.disambiguate`) fails in lazy-loaded rooms: it
 * files a member loaded later under their name with the user ID already added, so the member they
 * clash with keeps a plain name, and of two members loaded later it marks only the second.
 */
const nameIsShared = (room: Room, userId: string, name: string): boolean => {
  const wanted = removeHiddenChars(name);
  // Stand-ins for a room in tests may hold no member list.
  const members = room.getMembers?.() ?? [];
  return (
    wanted !== '' &&
    members.some(
      (other) =>
        other.userId !== userId &&
        !matchesEnum(other.membership, Membership.Leave) &&
        !matchesEnum(other.membership, Membership.Ban) &&
        comparableName(other) === wanted
    )
  );
};

/** `name` with the user ID after it, isolated so it reads left to right in any text. */
const withUserId = (name: string, userId: string): string => `${name} (\u2066${userId}\u2069)`;

/**
 * The name the room shows for a member as the sender of something, or undefined when they have
 * none of their own; a timeline event's `sender` names them as they were then. As matrix-js-sdk's
 * `RoomMember.name` does, the user ID follows a name that looks like a user ID or holds direction
 * marks; it also follows the name when another member of the `room` shows a name that reads the
 * same, decided from the room's members as they are now (the ones loaded later included), so
 * nobody can pass for someone else, an agent included; and it follows any name that holds one of
 * the characters above, which are left out of it, and a name that is the localpart another member
 * without a name shows as. The ID is isolated so it reads left to right in any text.
 */
export const getRoomMemberName = (
  member: RoomMember | null | undefined,
  room?: Room
): string | undefined => {
  const name = member ? shownName(member) : undefined;
  if (!member || name === undefined) return undefined;
  const clashes =
    member.disambiguate ||
    name !== member.rawDisplayName ||
    (!!room &&
      (nameIsShared(room, member.userId, name) || takesNamelessLocalpart(room, member, name)));
  return clashes ? withUserId(name, member.userId) : name;
};

/**
 * A name a member event carries for `userId` (joined as, changed their name to), shown as the room
 * shows names now: the user ID follows when another member of `room` shows a name that reads the
 * same, or when the name holds one of the characters above, which are left out.
 */
export const getMemberEventName = (room: Room, userId: string, name: string): string => {
  const shown = name.replace(NAME_DISGUISES, '');
  if (!shown.trim()) return name;
  return shown !== name || nameIsShared(room, userId, shown) ? withUserId(shown, userId) : shown;
};

/**
 * A member's own display name, without the user ID `getMemberDisplayName` may add: for text the
 * user sends, such as a mention's label, and for places that show the user ID beside it.
 */
export const getMemberRawDisplayName = (room: Room, userId: string): string | undefined => {
  const name = room.getMember(userId)?.rawDisplayName;
  return name && name !== userId ? name : undefined;
};

const contentName = (content: IContent): string | undefined =>
  typeof content.displayname === 'string' && content.displayname ? content.displayname : undefined;

/** The name a member event gives, else the name of the member event it replaced. */
const memberEventName = (event: MatrixEvent): string | undefined =>
  contentName(event.getContent()) ?? contentName(event.getPrevContent());

/**
 * The newest name `userId` had in the member events the client has loaded: in `timeline` before
 * position `end` (all of it by default), then in the timelines before it.
 */
export const memberNameBefore = (
  timeline: EventTimeline | null,
  userId: string,
  end = Infinity
): string | undefined => {
  let current = timeline;
  let before = end;
  while (current) {
    const events = current.getEvents();
    for (let index = Math.min(before, events.length) - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.getType() === EventType.RoomMember && event.getStateKey() === userId) {
        const name = memberEventName(event);
        if (name) return name;
      }
    }
    current = current.getNeighbouringTimeline(Direction.Backward);
    before = Infinity;
  }
  return undefined;
};

/** A name that reads like a Matrix user ID, as matrix-js-sdk's member names check. */
const USER_ID_SHAPE = /@.+:.+/;

/** Memberships that end someone's place in the room. */
const DEPARTED = [Membership.Leave, Membership.Ban];

/** The last names found for gone members, by the member event that took their name. */
const departedNames = new WeakMap<MatrixEvent, string>();

/**
 * The name a member who is gone (left, removed or banned) last had, when the event that ended
 * their membership carries none: a kick, a ban and the leave that lifts a ban do not. Their
 * earlier messages keep that name rather than their user ID; the ID follows it as
 * `getRoomMemberName` adds it, when a member of the room shows the same name or it looks like
 * an ID.
 */
const departedMemberName = (room: Room, userId: string): string | undefined => {
  const gone = room.getMember(userId);
  if (!gone || !DEPARTED.some((state) => matchesEnum(gone.membership, state))) return undefined;
  // Stand-in members of tests may come without their events.
  const ended = gone.events?.member;
  if (!ended) return undefined;
  const lastName =
    departedNames.get(ended) ??
    memberEventName(ended) ??
    memberNameBefore(room.getLiveTimeline(), userId);
  if (!lastName) return undefined;
  departedNames.set(ended, lastName);
  const shown = lastName.replace(NAME_DISGUISES, '');
  if (!shown.trim()) return undefined;
  const othersShowIt = room.currentState
    .getUserIdsWithDisplayName(shown)
    .some((other) => other !== userId);
  const needsId =
    othersShowIt ||
    shown !== lastName ||
    USER_ID_SHAPE.test(shown) ||
    takesNamelessLocalpart(room, gone, shown);
  return needsId ? `${shown} (\u2066${userId}\u2069)` : shown;
};

/**
 * `getRoomMemberName` of the room's current member `userId`; for a member who is gone without a
 * name, the name they last had.
 */
export const getMemberDisplayName = (room: Room, userId: string): string | undefined =>
  getRoomMemberName(room.getMember(userId), room) ?? departedMemberName(room, userId);

/**
 * The name to show for `userId` as a sender in places that name senders of rooms the user may not
 * have opened (Activity, system notifications). With lazy-loaded members such a room knows only
 * the members whose events its sync brought, so a member who copied the name of someone not loaded
 * yet would read as them. Until the room's member list is loaded the user ID follows every name,
 * and a sender without one shows as the user ID; once it is loaded, the name
 * `getMemberDisplayName` gives, else the user ID's localpart.
 */
export const getSenderName = (room: Room, userId: string): string => {
  const name = getMemberDisplayName(room, userId);
  if (room.membersLoaded()) return name ?? getMxIdLocalPart(userId) ?? userId;
  if (name === undefined) return userId;
  // `getMemberDisplayName` may have added the user ID already.
  return splitUserIdSuffix(name, userId)[1] ? name : withUserId(name, userId);
};

/**
 * A sender's name split before the user ID that `getRoomMemberName` or `getSenderName` put after
 * it: the name and ` (user ID)`, or the name and an empty string. For layouts that may cut a long
 * name short but must show the user ID whole, since it tells a copied name apart.
 */
export const splitUserIdSuffix = (name: string, userId: string): [name: string, suffix: string] => {
  const suffix = withUserId('', userId);
  return name.endsWith(suffix) && name.length > suffix.length
    ? [name.slice(0, -suffix.length), suffix]
    : [name, ''];
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

/**
 * The other person of a direct room, whose picture its avatar shows; a tile without one takes
 * that person's color too, so they look the same in the room list as next to their messages.
 */
export const getDirectPartnerId = (room: Room): string | undefined =>
  // Optional call: room list tests pass room stand-ins without member lookups.
  room.getAvatarFallbackMember?.()?.userId;

/** Whether our pending invite to the room is marked as a direct chat (`is_direct`). */
export const isDirectInvite = (room: Room, myUserId: string): boolean =>
  room.getMember(myUserId)?.events.member?.getContent().is_direct === true;

const relationType = (mEvent: MatrixEvent): string | undefined =>
  mEvent.getRelation()?.rel_type ?? undefined;

/** Reactions and edits annotate other events; timelines and unread counts skip them. */
export const reactionOrEditEvent = (mEvent: MatrixEvent): boolean => {
  if (matchesEnum(mEvent.getType(), EventType.Reaction)) return true;
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

const getNewContent = (edit: MatrixEvent): Record<string, unknown> | undefined => {
  const newContent = edit.getContent()['m.new_content'];
  return isRecord(newContent) ? newContent : undefined;
};

/**
 * A large streamed reply may leave its tool trace in an earlier edit (later ones carry it only in
 * a sidecar), so the newest edit borrows MindRoom metadata it lacks from the sender's older edits,
 * newest first. What the newest edit's wrapper carries already stays as it is.
 */
const fillMetadataFromOlderEdits = (latest: MatrixEvent, older: MatrixEvent[]): void => {
  const newContent = getNewContent(latest);
  if (!newContent || older.length === 0) return;
  const borrowed: Record<string, unknown> = {};
  copyResolvedEditMetadata(
    borrowed,
    older.map((edit) => edit.getContent())
  );
  const wrapper = latest.getContent();
  Object.entries(borrowed).forEach(([key, value]) => {
    if (newContent[key] === undefined && wrapper[key] === undefined) newContent[key] = value;
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
 * The edits by `mEvent`'s sender: the SDK's applied one, the relation edits, the bundled one and
 * the newest one the sync brought.
 */
const getEditCandidates = (
  eventId: string,
  mEvent: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined,
  serializedReplacementCandidate?: MatrixEvent
): MatrixEvent[] =>
  [
    getAppliedEdit(mEvent) ?? undefined,
    ...getRelationEdits(eventId, mEvent, timelineSet),
    serializedReplacementCandidate ?? getShallowSerializedReplacementEvent(mEvent),
    // One the SDK cannot decrypt is in none of those until the server bundles it after a reload.
    getSyncedEdit(eventId),
  ].filter(
    (candidate): candidate is MatrixEvent =>
      isSameSenderEditEvent(mEvent, candidate) && !candidate.isRedacted()
  );

// Optional call: thread tests pass edit stand-ins without decryption state.
const isUndecryptable = (edit: MatrixEvent): boolean => !!edit.isDecryptionFailure?.();

/** An edit whose new content is unknown: it could not be decrypted, or it is still encrypted. */
const isUnreadableEdit = (edit: MatrixEvent): boolean =>
  isUndecryptable(edit) ||
  (matchesEnum(edit.getType(), EventType.RoomMessageEncrypted) && !getNewContent(edit));

/**
 * The edit to show for `mEvent`: the newest readable replacement by its sender among the SDK's
 * applied replacement, the relation edits in `timelineSet`, and the replacement bundled by the
 * server. An edit that is not decrypted (yet) leaves the last readable version shown; it counts
 * once its key arrives. Pass `serializedReplacementCandidate` to reuse a bundle already read from
 * the event.
 */
export const getEditedEvent = (
  eventId: string,
  mEvent: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined,
  serializedReplacementCandidate?: MatrixEvent
): MatrixEvent | undefined => {
  const candidates = getEditCandidates(
    eventId,
    mEvent,
    timelineSet,
    serializedReplacementCandidate
  ).filter(
    // An edit the client cannot read yet shows once it decrypts; until then the newest one it can.
    (candidate) => !isUnreadableEdit(candidate) && isUsableEdit(candidate)
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
 * What `event` says now. The SDK can put an edit on an event before it decrypts the edit (one the
 * server bundles with the event), and then reads the event as empty; until that edit decrypts,
 * this is the event's content from before it.
 */
export const getReadableContent = (event: MatrixEvent): IContent => {
  const replacement = event.replacingEvent?.();
  return replacement && isUnreadableYet(replacement)
    ? event.getOriginalContent()
    : event.getContent();
};

/**
 * Whether `mEvent` has an edit by its sender that could not be decrypted and is newer than the
 * edit it shows (`shownEdit`, from `getEditedEvent`), or than the event itself without one.
 */
export const hasUndecryptedNewerEdit = (
  eventId: string,
  mEvent: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined,
  shownEdit: MatrixEvent | undefined
): boolean =>
  getEditCandidates(eventId, mEvent, timelineSet).some(
    (candidate) =>
      isUndecryptable(candidate) && (!shownEdit || isEventOrderedAfter(candidate, shownEdit))
  );

/**
 * The edits of `mEvent` by its sender still waiting to decrypt. Its row repaints once each one
 * decrypts or fails to, so the newer text or the note on an undecryptable edit shows.
 */
export const getPendingEdits = (
  eventId: string,
  mEvent: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined
): MatrixEvent[] =>
  getEditCandidates(eventId, mEvent, timelineSet).filter(
    (candidate) => isUnreadableYet(candidate) && !isUndecryptable(candidate)
  );

/**
 * The event's own content. The SDK's `getContent` gives the `m.new_content` of the edit it
 * applied, and nothing when that edit has none, as one that could not be decrypted.
 */
const getOwnContent = (event: MatrixEvent): IContent =>
  event.replacingEvent() ? event.getOriginalContent() : event.getContent();

/**
 * The content to render: the edit's `m.new_content` with the MindRoom metadata the edit carries
 * at its top level, or the event's own content without a readable edit by its sender.
 */
export const getLatestMessageContent = (
  targetEvent: MatrixEvent,
  editedEvent: MatrixEvent | undefined
): IContent => {
  if (!editedEvent || !isSameSenderEditEvent(targetEvent, editedEvent)) {
    return getOwnContent(targetEvent);
  }
  const newContent = getNewContent(editedEvent);
  if (!newContent) return getOwnContent(targetEvent);

  const content: IContent = { ...newContent };
  // MindRoom metadata the edit carries beside `m.new_content` belongs to the shown content too.
  copyResolvedEditMetadata(content, [editedEvent.getContent()]);
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
  if (!matchesEnum(mEvent.getType(), MessageEvent.RoomMessage)) return false;
  const relation = mEvent.getRelation();
  if (relation && relation.rel_type !== RelationType.Thread) return false;
  const content = mEvent.getContent();
  return (
    (typeof content.msgtype === 'string' && EDITABLE_MSGTYPES.has(content.msgtype)) ||
    isLongTextFile(content)
  );
};

// Event types that carry a message (Matrix Client-Server API modules: End-to-End Encryption for
// m.room.encrypted, Instant Messaging for m.room.message, Stickers for m.sticker), plus MindRoom's
// tool approval requests.
const TEXT_EVENT_TYPES = [MessageEvent.RoomMessageEncrypted, MessageEvent.RoomMessage];
const UNREAD_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  ...TEXT_EVENT_TYPES,
  MessageEvent.Sticker,
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
 * Whether the room has a message we have not read: walking back from the newest event, an
 * unread message (see `isMainTimelineMessageUnread`) before our read position or our own last
 * message.
 */
export const roomHaveUnread = (client: MatrixClient, room: Room): boolean => {
  const selfId = client.getUserId();
  if (!selfId) return false;
  const timeline = room.getLiveTimeline().getEvents();
  const readUpToId = room.getEventReadUpTo(selfId);
  let readTs: number | undefined;

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    if (!event) continue;
    if (readUpToId && event.getId() === readUpToId) return false;
    if (!isUnreadWorthy(event)) continue;
    if (event.getSender() === selfId) return false;
    readTs ??= getMainTimelineReadTs(room, selfId);
    // The timeline is in order, so everything older was read too.
    if (event.getTs() <= readTs) return false;
    if (isMainTimelineMessageUnread(room, event, selfId, readTs)) return true;
  }
  return false;
};

/**
 * Whether everything the server counts as unread in the room's main timeline is read by this
 * client's rule (`isMainTimelineMessageUnread`): roots the user opened on this device, which a
 * thread receipt does not read on the server.
 *
 * The walk goes back from the newest loaded event to the user's read position or own last
 * message, and stops at the first message that is unread by the client's rule. The read ones
 * that notified must cover the whole count: the history not loaded may hold the rest.
 */
export const isMainUnreadCountRead = (mx: MatrixClient, room: Room): boolean => {
  const selfId = mx.getUserId();
  // Optional calls: room and client stand-ins in tests often have no counts or push actions.
  const counted = room.getRoomUnreadNotificationCount?.(NotificationCountType.Total) ?? 0;
  if (!selfId || counted === 0) return false;
  const timeline = room.getLiveTimeline().getEvents();
  const readUpToId = room.getEventReadUpTo(selfId);
  const readTs = getMainTimelineReadTs(room, selfId);
  let read = 0;

  for (let index = timeline.length - 1; index >= 0 && read < counted; index -= 1) {
    const event = timeline[index];
    if (!event) continue;
    if (event.getId() === readUpToId || event.getTs() <= readTs) break;
    if (!isUnreadWorthy(event)) continue;
    if (event.getSender() === selfId) break;
    if (isMainTimelineMessageUnread(room, event, selfId, readTs)) return false;
    if (mx.getPushActionsForEvent?.(event)?.notify) read += 1;
  }
  return read >= counted;
};

/** How opening a thread reads its root; see `getThreadRootReadAction`. */
export type ThreadRootReadAction = 'receipt' | 'seen';

/**
 * How to mark a thread's root read when the user opens the thread. The root belongs to the main
 * timeline, and the main receipt this client sends names its newest event
 * (`markMainTimelineAsRead`), so it reads all of it. So `receipt`, a main receipt, only once
 * nothing else there is unread (`isMainTimelineMessageUnread`, which counts the roots seen before
 * as read), and until then `seen`: the root counts as read on this device
 * (`rememberSeenThreadRoot`). Undefined when the root is read already.
 *
 * The walk goes back from the newest loaded event to the user's read position or own last
 * message. When it runs out of loaded events first, the server's count of unread main-timeline
 * notifications tells whether the history not loaded holds more than this root and the roots seen
 * before.
 */
export const getThreadRootReadAction = (
  mx: MatrixClient,
  room: Room,
  root: MatrixEvent
): ThreadRootReadAction | undefined => {
  const selfId = mx.getUserId();
  if (!selfId) return undefined;
  const readTs = getMainTimelineReadTs(room, selfId);
  if (!isMainTimelineMessageUnread(room, root, selfId, readTs)) return undefined;
  const readUpToId = room.getEventReadUpTo(selfId);
  const timeline = room.getLiveTimeline();
  const events = timeline.getEvents();

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.getId() === root.getId()) continue;
    // The timeline is in order, so everything older was read too.
    if (event.getId() === readUpToId || event.getTs() <= readTs) return 'receipt';
    if (!isUnreadWorthy(event)) continue;
    if (event.getSender() === selfId) return 'receipt';
    if (isMainTimelineMessageUnread(room, event, selfId, readTs)) return 'seen';
  }

  const olderNotLoaded =
    timeline.getPaginationToken(Direction.Backward) !== null ||
    !!timeline.getNeighbouringTimeline(Direction.Backward);
  if (!olderNotLoaded) return 'receipt';
  const known =
    (mx.getPushActionsForEvent(root)?.notify ? 1 : 0) +
    countSeenThreadRootsAfter(selfId, room.roomId, readTs);
  const counted = room.getRoomUnreadNotificationCount(NotificationCountType.Total) ?? 0;
  return counted <= known ? 'receipt' : 'seen';
};

export const getUnreadInfo = (room: Room) => ({
  roomId: room.roomId,
  highlight: room.getUnreadNotificationCount('highlight' as never) ?? 0,
  total: room.getUnreadNotificationCount('total' as never) ?? 0,
});

/**
 * Decrypts every encrypted event of the timeline that has not been decrypted yet, and waits for
 * the ones already decrypting. The client's crypto API is the backend that decrypts them.
 */
export const decryptAllTimelineEvent = async (
  mx: MatrixClient,
  timeline: EventTimeline
): Promise<void> => {
  // Without a crypto backend there is nothing to decrypt with.
  const backend = mx.getCrypto() as unknown as CryptoBackend | undefined;
  if (!backend) return;
  const pending: Promise<void>[] = [];
  for (const event of timeline.getEvents()) {
    if (event.shouldAttemptDecryption()) pending.push(event.attemptDecryption(backend));
    else if (event.isBeingDecrypted()) pending.push(event.getDecryptionPromise()!);
  }
  await Promise.all(pending);
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
