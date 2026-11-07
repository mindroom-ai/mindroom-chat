import type { MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import { getActiveSession } from '../session/sessions';

/**
 * Whether an agent marked the event as the start of a conversation: its content says
 * `io.mindroom.conversation: true`, as on a card or a report an agent sends as a notice, and its
 * sender is a MindRoom agent on the homeserver of the active account, since any member can write
 * the key. Without an active account no notice counts. The content is the latest edit's, so an
 * agent keeps the mark in its edits' `m.new_content` too.
 */
const isConversationNotice = (event: MatrixEvent): boolean =>
  event.getContent()['io.mindroom.conversation'] === true &&
  isMindroomAgentUserIdForViewer(event.getSender(), getActiveSession()?.userId);

/**
 * Whether the event is a notice no agent marked as the start of a conversation
 * (`isConversationNotice`), such as an agent's status line: the thread lists show it only once its
 * thread has replies.
 */
export const isUnmarkedNotice = (event: MatrixEvent): boolean =>
  event.getContent()?.msgtype === 'm.notice' && !isConversationNotice(event);
