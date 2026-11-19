import type { RoomThreadMode } from '../matrix/protocol/roomThreadMode';
import type { IReplyDraft } from './roomInputDrafts';
import { hasExplicitThreadContext } from './roomInputSendSession';

/** What Send does from the composer, so its placeholder can say so. */
export type ComposerPlaceholderKind = 'reply-in-thread' | 'new-thread' | 'message';

/**
 * The thread a send joins, as `getRoomInputSendMode` routes it; otherwise a new thread from the
 * main timeline, unless the room shows a classic timeline, the message replies to one outside any
 * thread, or the room's agents answer in the main timeline.
 */
export const getComposerPlaceholderKind = ({
  threadId,
  replyDraft,
  threadingEnabled,
  roomThreadMode,
}: {
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled: boolean;
  roomThreadMode?: RoomThreadMode;
}): ComposerPlaceholderKind => {
  if (hasExplicitThreadContext(threadId, replyDraft, threadingEnabled)) return 'reply-in-thread';
  if (!threadingEnabled || replyDraft || roomThreadMode === 'room') return 'message';
  return 'new-thread';
};
