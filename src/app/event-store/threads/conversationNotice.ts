import type { MatrixEvent } from 'matrix-js-sdk';
import { isTrustedAgentSender } from '../../matrix/protocol/untrustedContent';

/**
 * Whether an agent marked the event as the start of a conversation: its content says
 * `io.mindroom.conversation: true`, as on a card or a report an agent sends as a notice, and its
 * sender is a MindRoom agent on the homeserver of an account signed in on this device
 * (`isTrustedAgentSender`), since any member can write the key. The content is the latest edit's,
 * so an agent keeps the mark in its edits' `m.new_content` too. The thread lists show such a
 * notice before anyone replies, as they show any message; any other notice lists only once its
 * thread has replies.
 */
export const isConversationNotice = (event: MatrixEvent): boolean =>
  event.getContent()['io.mindroom.conversation'] === true &&
  isTrustedAgentSender(event.getSender());
