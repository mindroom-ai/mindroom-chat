import type { IContent, MatrixEvent, Room } from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';
import { getEditedEvent } from './room';

const isContent = (value: unknown): value is IContent => isRecord(value);

/**
 * The content a reply to `message` quotes: the replacement content of its newest edit when there
 * is one, otherwise its own content (the decrypted one, for an encrypted message).
 */
export const getQuotedContent = (room: Room, eventId: string, message: MatrixEvent): IContent => {
  const edit = getEditedEvent(eventId, message, room.getUnfilteredTimelineSet());
  const replacement: unknown = edit?.getContent()['m.new_content'];
  return isContent(replacement) ? replacement : message.getContent();
};
