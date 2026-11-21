import { EventType, type Room, type RoomMember } from 'matrix-js-sdk';
import { normalizeSearchString } from '../../lib/hooks/useAsyncSearch';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { withoutNameDisguises } from '../../matrix/room';

/**
 * The user name prefix MindRoom gives every agent account (MindRoom's
 * `matrix_identifiers.agent_username_localpart`). Every agent matches it, so it never tells which
 * agent someone means.
 */
const AGENT_PREFIX = 'mindroom_';

/** The owner keeps the old router user name, with an optional installation namespace. */
const ROUTER_AGENT = /^router(?:_[a-z0-9]{4,32})?$/;

const WORD_BREAK = /[^\p{L}\p{N}]+/u;

// An event's type is any string, so it is compared as one.
const ROOM_MESSAGE: string = EventType.RoomMessage;

type MentionCandidate = Pick<RoomMember, 'userId' | 'rawDisplayName' | 'name'>;

/**
 * The name a member is shown and mentioned by, without the characters that disguise a name (the
 * suggestion shows the user ID beside it), so a mention sends none of them.
 */
export const memberName = (member: MentionCandidate): string =>
  withoutNameDisguises(member.rawDisplayName || member.name || '') ||
  getMxIdLocalPart(member.userId) ||
  member.userId;

const localpart = (userId: string): string =>
  normalizeSearchString(getMxIdLocalPart(userId) ?? userId);

/** An agent's user name without MindRoom's agent prefix; anyone else's user name as it is. */
const userName = (userId: string): string => {
  const name = localpart(userId);
  return name.startsWith(AGENT_PREFIX) ? name.slice(AGENT_PREFIX.length) : name;
};

const isOwnerAccount = (userId: string): boolean => {
  const name = localpart(userId);
  return name.startsWith(AGENT_PREFIX) && ROUTER_AGENT.test(name.slice(AGENT_PREFIX.length));
};

const startsAWord = (value: string, needle: string): boolean =>
  value.split(WORD_BREAK).some((word) => word.startsWith(needle));

/**
 * How well a member matches `needle` (typed text, normalized by `normalizeSearchString`): lower
 * is better, undefined is no match. The display name decides first: all of it, its start, then
 * the start of a later word. The user name follows, without MindRoom's agent prefix, then the
 * whole user ID, which only someone typing the prefix itself matches. Text inside the name or user
 * name comes last.
 */
export const mentionRank = (member: MentionCandidate, needle: string): number | undefined => {
  const name = normalizeSearchString(memberName(member));
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (startsAWord(name, needle)) return 2;
  const user = userName(member.userId);
  if (user.startsWith(needle)) return 3;
  if (startsAWord(user, needle)) return 4;
  // Every agent's ID starts with the prefix, so text the prefix starts with matches no ID.
  const typedPrefix = !AGENT_PREFIX.startsWith(needle) || needle === AGENT_PREFIX;
  if (typedPrefix && normalizeSearchString(member.userId.slice(1)).startsWith(needle)) return 5;
  if (name.includes(needle) || user.includes(needle)) return 6;
  return undefined;
};

/** What `recentSenders` reads of a room; a room without timelines has no recent senders. */
export type SenderTimelines = Partial<Pick<Room, 'getLiveTimeline' | 'getThreads'>>;

/** Who sent the messages the client holds for the room, threads included: latest first. */
export const recentSenders = (room: SenderTimelines): string[] => {
  const latest = new Map<string, number>();
  const timelines = [
    room.getLiveTimeline?.(),
    ...(room.getThreads?.().map((thread) => thread.liveTimeline) ?? []),
  ];
  timelines.forEach((timeline) =>
    timeline?.getEvents().forEach((event) => {
      const sender = event.getSender();
      if (!sender || event.getType() !== ROOM_MESSAGE) return;
      latest.set(sender, Math.max(latest.get(sender) ?? 0, event.getTs()));
    })
  );
  return [...latest].sort(([, left], [, right]) => right - left).map(([sender]) => sender);
};

/**
 * Members to offer as mentions, excluding the owner, which never answers. Equal matches keep
 * the order of who sent a message most recently, then the order given.
 */
export const orderMentionCandidates = <T extends MentionCandidate>(
  members: readonly T[],
  senders: readonly string[]
): T[] => {
  const recency = new Map(senders.map((userId, index) => [userId, index]));
  const recent = (member: T): number => recency.get(member.userId) ?? senders.length;
  return members
    .filter((member) => !isOwnerAccount(member.userId))
    .sort((left, right) => recent(left) - recent(right));
};
