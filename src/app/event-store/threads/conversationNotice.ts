import type { MatrixEvent } from 'matrix-js-sdk';
import { isTrustedAgentSender } from '../../matrix/protocol/untrustedContent';

/**
 * Whether an agent marked the event as the start of a conversation: its content says
 * `io.mindroom.conversation: true`, as on a card or a report an agent sends as a notice, and its
 * sender is a MindRoom agent on the viewer's homeserver (`isTrustedAgentSender`), since any member
 * can write the key. The thread lists show such a notice as a conversation and leave out the
 * other notices.
 */
export const isConversationNotice = (event: MatrixEvent): boolean =>
  event.getContent()['io.mindroom.conversation'] === true &&
  isTrustedAgentSender(event.getSender());
