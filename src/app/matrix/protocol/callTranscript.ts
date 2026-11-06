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
export const CALL_TRANSCRIPT_MAX_TURNS = 1000;
/** Longest text of one turn the card shows, in UTF-16 code units; longer renders as the HTML. */
export const CALL_TRANSCRIPT_MAX_TEXT_LENGTH = 10_000;
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
    typeof sender === 'string' &&
    isUserId(sender) &&
    typeof text === 'string' &&
    text.trim() !== '' &&
    text.length <= CALL_TRANSCRIPT_MAX_TEXT_LENGTH
  );
};

/**
 * The transcript in `content`, or undefined when it is missing or malformed in any part (then the
 * message renders as its HTML, which carries the same turns): a duration that is not a number of
 * seconds up to a week, no turns or more than the card shows, or a turn without a user ID and
 * text of its own.
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
