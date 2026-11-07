import type { MatrixEvent } from 'matrix-js-sdk';
import { isTrustedAgentSender } from '../../matrix/protocol/untrustedContent';

/**
 * Whether an agent marked the event as the start of a conversation: its content says
 * `io.mindroom.conversation: true`, as on a card or a report an agent sends as a notice, and its
 * sender is a MindRoom agent on the viewer's homeserver (`isTrustedAgentSender`), since any member
 * can write the key. The content is the latest edit's, so an edit keeps the mark only in its
 * `m.new_content`. The thread lists show such a notice before anyone replies, as they show any
 * message; any other notice lists only once its thread has replies.
 */
export const isConversationNotice = (event: MatrixEvent): boolean =>
  event.getContent()['io.mindroom.conversation'] === true &&
  isTrustedAgentSender(event.getSender());
