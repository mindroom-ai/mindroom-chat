import type { IContent, MatrixEvent } from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';

/**
 * What a pin says, and whether that is an edit: the edited content the SDK applied, unless the
 * newest edit has no readable content yet (it is still being decrypted, or could not be), which
 * the SDK reads as an empty message; then the message as it was sent.
 */
export const getPinContent = (event: MatrixEvent): { content: IContent; edited: boolean } => {
  const edit = event.replacingEvent();
  if (!edit) return { content: event.getContent(), edited: false };
  if (isRecord(edit.getContent()['m.new_content'])) {
    return { content: event.getContent(), edited: true };
  }
  return { content: event.getOriginalContent(), edited: false };
};
