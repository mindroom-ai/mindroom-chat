import type { MatrixEvent } from 'matrix-js-sdk';
import { isThreadReplyEvent } from '../event-store/threads/threadUtils';
import type { PluginEvent } from '../plugins/messageRenderers';
import { genuineReplyEventId, isRowlessTimelineEvent } from './timelineRowFold';

/**
 * Whether a plugin's message renderer leaves `event` without a row (`MessageRenderer.hidden`,
 * asked through `rowHidden`, which the timeline gives only in an open thread). Only a reply in a
 * thread may go: hiding a thread's root would hide its thread, and a message outside any thread
 * stays, as does a redacted one. One the route or a jump opened (`revealedIds`) stays too, so a
 * link to it lands on it. `getContent` gives what its row would show, latest edit included;
 * without `rowHidden` (no renderer hides rows) nothing is asked.
 */
export const isPluginHiddenRow = (
  event: MatrixEvent,
  getContent: (event: MatrixEvent) => Record<string, unknown>,
  rowHidden: ((event: PluginEvent) => boolean) | undefined,
  revealedIds?: ReadonlySet<string>
): boolean => {
  if (!rowHidden) return false;
  // A redacted event's row follows the timeline's own rule, and an edit, a reaction or an event of a
  // type the timeline draws no row for has none.
  if (event.isRedacted() || isRowlessTimelineEvent(event)) return false;
  const eventId = event.getId();
  const sender = event.getSender();
  if (!eventId || !sender || !isThreadReplyEvent(eventId, event.threadRootId)) return false;
  if (revealedIds?.has(eventId)) return false;
  // Read only if asked: the test asks the sender first, and most replies are people's.
  let content: Record<string, unknown> | undefined;
  return rowHidden({
    eventId,
    roomId: event.getRoomId(),
    type: event.getType(),
    sender,
    get content() {
      content ??= getContent(event);
      return content;
    },
  });
};

/**
 * The message `event`'s row needs no quote of: the one the row fold found in place, or the one it
 * replies to when a plugin hides that (`isHidden`), so no row quotes a hidden message, such as an
 * agent's answer to the message that woke it.
 */
export const replyNeedingNoQuote = (
  event: MatrixEvent,
  inPlaceReplyEventId: string | undefined,
  isHidden: (eventId: string) => boolean
): string | undefined => {
  const replyEventId = genuineReplyEventId(event);
  return replyEventId !== undefined &&
    replyEventId !== inPlaceReplyEventId &&
    isHidden(replyEventId)
    ? replyEventId
    : inPlaceReplyEventId;
};
