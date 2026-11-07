import type { MatrixEvent } from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';
import { isTrustedAgentSender } from './untrustedContent';

/**
 * The row MindRoom's router posts when a call between people starts in a room, a notice with
 * `{"call_id": "<id>"}` under this key. The router edits it when the call ends, adding `ended_at`
 * and `duration_seconds`, and again once the transcript message is posted, adding
 * `transcript_event_id`. Any member can write it into a message, so it counts only from an agent
 * (`AGENT_ONLY_CONTENT_KEYS`), and only the agent's own edits replace it.
 */
export const CALL_ROW_KEY = 'io.mindroom.call';

/**
 * The message the router posts in the row's thread when the call has ended: the notes as its body,
 * the transcript under `io.mindroom.call_transcript`, and `{"call_id": "<id>"}` under this key.
 */
export const CALL_NOTES_KEY = 'io.mindroom.call_notes';

/** A call's row as its latest edit has it: live while unedited, then over. */
export type CallRowContent = {
  callId: string;
  /** Set once the router edited the row for the call's end. */
  ended?: {
    /** How long the call lasted, in whole seconds. */
    durationSeconds?: number;
    /** The transcript message in the row's thread, once posted. */
    transcriptEventId?: string;
  };
};

/** Longest call a row or a transcript shows, in seconds: a week. */
export const MAX_CALL_SECONDS = 7 * 24 * 3600;

const readCallId = (value: Record<string, unknown>): string | undefined => {
  const { call_id: callId } = value;
  return typeof callId === 'string' && callId !== '' ? callId : undefined;
};

/** The call a row stands for, and how it ended once it has; undefined for any other message. */
export const readCallRow = (content: Record<string, unknown>): CallRowContent | undefined => {
  const value = content[CALL_ROW_KEY];
  if (!isRecord(value)) return undefined;
  const callId = readCallId(value);
  if (!callId) return undefined;
  const {
    ended_at: endedAt,
    duration_seconds: duration,
    transcript_event_id: transcriptEventId,
  } = value;
  if (endedAt === undefined && duration === undefined && transcriptEventId === undefined) {
    return { callId };
  }
  const ended: NonNullable<CallRowContent['ended']> = {};
  if (
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration >= 0 &&
    duration <= MAX_CALL_SECONDS
  ) {
    ended.durationSeconds = Math.round(duration);
  }
  if (typeof transcriptEventId === 'string' && transcriptEventId.startsWith('$')) {
    ended.transcriptEventId = transcriptEventId;
  }
  return { callId, ended };
};

/** The call a transcript message tells of, or undefined for any other message. */
export const readCallNotes = (content: Record<string, unknown>): string | undefined => {
  const value = content[CALL_NOTES_KEY];
  return isRecord(value) ? readCallId(value) : undefined;
};

/** Whether `event` is a call's row: from a MindRoom agent, and not taken back. */
export const isCallRowEvent = (event: MatrixEvent): boolean =>
  readCallRow(event.getContent()) !== undefined &&
  isTrustedAgentSender(event.getSender()) &&
  !event.isRedacted();
