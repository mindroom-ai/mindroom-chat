import type { MatrixEvent } from 'matrix-js-sdk';
import { isThreadReplyEvent } from '../event-store/threads/threadUtils';
import type { PluginEvent } from '../plugins/messageRenderers';

/**
 * Whether a plugin's message renderer leaves `event` without a row (`MessageRenderer.hidden`,
 * asked through `rowHidden`). Only a reply in a thread may go: hiding a thread's root would hide
 * its thread, and a message outside any thread stays. One the route or a jump opened
 * (`revealedIds`) stays too, so a link to it lands on it. `getContent` gives what its row would
 * show, latest edit included; without `rowHidden` (no renderer hides rows) nothing is asked.
 */
export const isPluginHiddenRow = (
  event: MatrixEvent,
  getContent: (event: MatrixEvent) => Record<string, unknown>,
  rowHidden: ((event: PluginEvent) => boolean) | undefined,
  revealedIds?: ReadonlySet<string>
): boolean => {
  if (!rowHidden) return false;
  const eventId = event.getId();
  const sender = event.getSender();
  if (!eventId || !sender || !isThreadReplyEvent(eventId, event.threadRootId)) return false;
  if (revealedIds?.has(eventId)) return false;
  return rowHidden({
    eventId,
    roomId: event.getRoomId(),
    type: event.getType(),
    sender,
    content: getContent(event),
  });
};
