import type { MatrixEvent } from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';

export const THREAD_SNOOZE_CONTENT_KEY = 'io.mindroom.thread_snooze';

/**
 * Whether message content is the backend's snooze-ended message, and its note.
 * null: not a snooze-ended message; undefined: one without a note; string: its note.
 * The note is the plain body's text after "Snooze ended: ", so agent pills in a formatted body
 * and a reply fallback before it do not matter.
 */
export const readSnoozeEndedNote = (
  content: Record<string, unknown>
): string | undefined | null => {
  const marker = content[THREAD_SNOOZE_CONTENT_KEY];
  if (!isRecord(marker) || marker.event !== 'ended') return null;
  const body = typeof content.body === 'string' ? content.body : '';
  const note = /Snooze ended: ([\s\S]*)$/.exec(body)?.[1]?.trim();
  return note || undefined;
};

export const getSnoozeEndedNote = (event: MatrixEvent): string | undefined | null =>
  readSnoozeEndedNote(event.getContent());
