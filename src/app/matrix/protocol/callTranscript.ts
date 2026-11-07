import { isRecord } from '../../lib/isRecord';
import { isUserId } from '../matrix';
import { isMindroomAgentUserId, isMindroomAgentUserIdForViewer } from './agentIdentity';
import { MAX_CALL_SECONDS, readCallNotes } from './callRow';

/**
 * The structured transcript MindRoom adds to the message it posts after a voice call, beside the
 * plain and HTML bodies other clients show:
 * `{ duration_seconds, turns: [{ sender, text, offset_seconds? }] }`, each turn one speaker's words
 * by Matrix user ID, in the order they were spoken, with when the turn began in seconds from the
 * call's start (newer MindRoom versions only). Any member can write it into a message, so it
 * counts only from an agent (`AGENT_ONLY_CONTENT_KEYS`).
 */
export const CALL_TRANSCRIPT_KEY = 'io.mindroom.call_transcript';

/**
 * Most turns the card shows; a longer transcript renders as the message's HTML, or for a call
 * between people as its first turns.
 */
export const CALL_TRANSCRIPT_MAX_TURNS = 2000;
/**
 * Most text the card shows, all turns together, in UTF-16 code units; past it as past the most
 * turns. One turn may be long: a speaker's words merge into one turn.
 */
export const CALL_TRANSCRIPT_MAX_TOTAL_LENGTH = 500_000;
/** How much of a long turn shows until the reader asks for the rest. */
export const CALL_TRANSCRIPT_TURN_PREVIEW_LENGTH = 1000;

export type CallTranscriptTurn = {
  sender: string;
  text: string;
  /** Whole seconds from the call's start to the turn's; missing in older transcripts. */
  offsetSeconds?: number;
};

export type CallTranscript = {
  /** Whole seconds from the start of the call to its end. */
  durationSeconds: number;
  turns: CallTranscriptTurn[];
  /**
   * The call between people the message tells of (`io.mindroom.call_notes`); its body is then
   * the call's notes. None for a call with an agent, whose body is the transcript again.
   */
  callId?: string;
  /** A call between people whose body is only the one-line summary ("Call · 12 min"): no notes. */
  summaryOnly?: boolean;
  /** The turns of a call between people past the card's limits, which it leaves out. */
  moreTurns?: number;
};

/** The body the router writes for a call between people when no model writes notes. */
const SUMMARY_ONLY_BODY = /^Call · \d+ min$/;

/** The memberships a speaker of a voice call with an agent may have: joined. */
const JOINED: ReadonlySet<string> = new Set(['join']);
/**
 * The memberships a speaker of a call between people may have: in the room then, so joined, or
 * left or banned since; the transcript stays whole when one of them leaves.
 */
const WAS_IN_ROOM: ReadonlySet<string> = new Set(['join', 'leave', 'ban']);

/**
 * A run of turns by one speaker; `index` is its first turn's place in the transcript and
 * `offsetSeconds` that turn's time, when it has one.
 */
export type CallTranscriptGroup = {
  sender: string;
  texts: string[];
  index: number;
  offsetSeconds?: number;
};

const isTurn = (value: unknown): value is Record<string, unknown> & CallTranscriptTurn => {
  if (!isRecord(value)) return false;
  const { sender, text } = value;
  return (
    typeof sender === 'string' && isUserId(sender) && typeof text === 'string' && text.trim() !== ''
  );
};

/**
 * A turn's time, or undefined when it is not a whole number of seconds within the call: then the
 * turn shows no time.
 */
const readOffset = (value: unknown, duration: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= duration
    ? value
    : undefined;

/**
 * The transcript in `content`, or undefined when it is missing or malformed in any part (then the
 * message renders as its HTML, which carries the same turns): a duration that is not a number of
 * seconds up to a week, no turns, or a turn without a user ID and text of its own. Past the turns
 * or the text the card shows, a call between people (whose body holds only its notes) keeps its
 * first turns within them and counts the rest; any other message renders as its HTML. A turn's
 * time is optional: one that is missing or outside the call is left out, and the turn still shows.
 */
export const readCallTranscript = (
  content: Record<string, unknown>
): CallTranscript | undefined => {
  const value = content[CALL_TRANSCRIPT_KEY];
  if (!isRecord(value)) return undefined;
  const { duration_seconds: duration, turns } = value;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > MAX_CALL_SECONDS
  ) {
    return undefined;
  }
  if (!Array.isArray(turns) || turns.length === 0 || !turns.every(isTurn)) return undefined;
  let length = 0;
  const past = turns.findIndex(({ text }, index) => {
    length += text.length;
    return index === CALL_TRANSCRIPT_MAX_TURNS || length > CALL_TRANSCRIPT_MAX_TOTAL_LENGTH;
  });
  const shown = past === -1 ? turns : turns.slice(0, past);
  const callId = readCallNotes(content);
  if (shown.length === 0 || (shown.length < turns.length && callId === undefined)) return undefined;
  const { body } = content;
  return {
    durationSeconds: Math.round(duration),
    turns: shown.map(({ sender, text, offset_seconds: offset }) => ({
      sender,
      text,
      offsetSeconds: readOffset(offset, duration),
    })),
    ...(callId === undefined
      ? {}
      : {
          callId,
          summaryOnly: typeof body === 'string' && SUMMARY_ONLY_BODY.test(body.trim()),
          ...(shown.length < turns.length ? { moreTurns: turns.length - shown.length } : {}),
        }),
  };
};

/**
 * The memberships that count a member as the transcript's speaker: joined, and for a call between
 * people (`io.mindroom.call_notes`) also left or banned since the call.
 */
export const speakerMemberships = (transcript: CallTranscript): ReadonlySet<string> =>
  transcript.callId === undefined ? JOINED : WAS_IN_ROOM;

/**
 * Whether the card may name the transcript's speakers. Any account can write the key with any user
 * ID as a turn's sender, and the card shows that member's name and avatar beside the words, so:
 * the poster is an agent of the viewer's homeserver, every turn by an agent account (of any
 * homeserver) is the poster's own, and every other turn is a member of the room
 * (`speakerMemberships`).
 */
export const callTranscriptSpeakersTrusted = (
  transcript: CallTranscript,
  poster: string | undefined,
  viewer: string | undefined,
  isMember: (userId: string) => boolean
): boolean =>
  isMindroomAgentUserIdForViewer(poster, viewer) &&
  transcript.turns.every(({ sender }) =>
    isMindroomAgentUserId(sender) ? sender === poster : isMember(sender)
  );

/**
 * Consecutive turns by one speaker under one name, as a chat groups messages; a group takes its
 * first turn's time.
 */
export const groupCallTranscriptTurns = (
  turns: readonly CallTranscriptTurn[]
): CallTranscriptGroup[] =>
  turns.reduce<CallTranscriptGroup[]>((groups, { sender, text, offsetSeconds }, index) => {
    const last = groups[groups.length - 1];
    if (last?.sender === sender) last.texts.push(text);
    else groups.push({ sender, texts: [text], index, offsetSeconds });
    return groups;
  }, []);

/**
 * The start of a turn longer than `limit`: cut at its last space within the limit when that
 * keeps most of it, else at the limit, never between the halves of a character, then an
 * ellipsis. A shorter turn comes back whole.
 */
export const clipTurnText = (
  text: string,
  limit = CALL_TRANSCRIPT_TURN_PREVIEW_LENGTH
): { text: string; clipped: boolean } => {
  if (text.length <= limit) return { text, clipped: false };
  const head = text.slice(0, limit + 1);
  const space = head.lastIndexOf(' ');
  const cut = space >= limit / 2 ? head.slice(0, space) : head.slice(0, limit);
  return { text: `${cut.replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`, clipped: true };
};
