import type { MatrixEvent } from 'matrix-js-sdk';
import { getReadableContent } from '../../matrix/room';
import { NO_KEYS, questionOptionReactionKeys } from '../../matrix/protocol/interactiveQuestion';
import { useMessageRenderer } from '../../plugins/messageRenderers';

/**
 * The reaction chips a message hides: its question's options, while the core question card shows
 * them and the answer. A client plugin that renders the message instead shows no card, so there
 * the chips stay.
 */
export const useHiddenQuestionReactions = (
  targetEvent: MatrixEvent | undefined,
  roomId: string,
  viewerId: string | undefined
): ReadonlySet<string> => {
  const keys = questionOptionReactionKeys(targetEvent, viewerId);
  const sender = targetEvent?.getSender();
  const plugin = useMessageRenderer(
    keys.size > 0 && targetEvent && sender
      ? {
          eventId: targetEvent.getId(),
          roomId,
          type: targetEvent.getType(),
          sender,
          content: getReadableContent(targetEvent),
        }
      : undefined,
    viewerId
  );
  return plugin ? NO_KEYS : keys;
};
