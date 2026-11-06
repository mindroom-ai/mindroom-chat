import { isRecord } from '../../lib/isRecord';
import { isUserId } from '../matrix';

/**
 * The structured transcript MindRoom adds to the message it posts after a voice call, beside the
 * plain and HTML bodies other clients show: `{ duration_seconds, turns: [{ sender, text }] }`,
 * each turn one speaker's words by Matrix user ID, in the order they were spoken. Any member can
 * write it into a message, so it counts only from an agent (`AGENT_ONLY_CONTENT_KEYS`).
 */
export const CALL_TRANSCRIPT_KEY = 'io.mindroom.call_transcript';

/** Most turns the card shows; a longer transcript renders as the message's HTML. */
export const CALL_TRANSCRIPT_MAX_TURNS = 2000;
/**
 * Most text the card shows, all turns together, in UTF-16 code units; a longer transcript renders
 * as the message's HTML. One turn may be long: a speaker's words merge into one turn.
 */
export const CALL_TRANSCRIPT_MAX_TOTAL_LENGTH = 500_000;
/** How much of a long turn shows until the reader asks for the rest. */
export const CALL_TRANSCRIPT_TURN_PREVIEW_LENGTH = 1000;
/** Longest call the card shows, in seconds: a week. */
const MAX_DURATION_SECONDS = 7 * 24 * 3600;

export type CallTranscriptTurn = { sender: string; text: string };

export type CallTranscript = {
  /** Whole seconds from the start of the call to its end. */
  durationSeconds: number;
  turns: CallTranscriptTurn[];
};

/** A run of turns by one speaker; `index` is its first turn's place in the transcript. */
export type CallTranscriptGroup = { sender: string; texts: string[]; index: number };

const isTurn = (value: unknown): value is CallTranscriptTurn => {
  if (!isRecord(value)) return false;
  const { sender, text } = value;
  return (
    typeof sender === 'string' && isUserId(sender) && typeof text === 'string' && text.trim() !== ''
  );
};

/**
 * The transcript in `content`, or undefined when it is missing or malformed in any part (then the
 * message renders as its HTML, which carries the same turns): a duration that is not a number of
 * seconds up to a week, no turns or more than the card shows, a turn without a user ID and text
 * of its own, or more text than the card shows.
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
    duration > MAX_DURATION_SECONDS
  ) {
    return undefined;
  }
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > CALL_TRANSCRIPT_MAX_TURNS) {
    return undefined;
  }
  if (!turns.every(isTurn)) return undefined;
  const length = turns.reduce((sum, { text }) => sum + text.length, 0);
  if (length > CALL_TRANSCRIPT_MAX_TOTAL_LENGTH) return undefined;
  return {
    durationSeconds: Math.round(duration),
    turns: turns.map(({ sender, text }) => ({ sender, text })),
  };
};

/** Consecutive turns by one speaker under one name, as a chat groups messages. */
export const groupCallTranscriptTurns = (
  turns: readonly CallTranscriptTurn[]
): CallTranscriptGroup[] =>
  turns.reduce<CallTranscriptGroup[]>((groups, { sender, text }, index) => {
    const last = groups[groups.length - 1];
    if (last?.sender === sender) last.texts.push(text);
    else groups.push({ sender, texts: [text], index });
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
