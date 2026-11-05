import { MsgType, type MatrixClient } from 'matrix-js-sdk';
import { getMxIdLocalPart } from '../matrix/matrix';
import { getMemberDisplayName } from '../matrix/room';
import { sanitizeText } from '../rich-text/sanitize';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';

export const COMPUTER_CONTINUATION_TEXT = 'The computer is available again. Please continue.';

export const sendComputerContinuation = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string | undefined,
  agentUserId: string
): Promise<void> => {
  const relation = getMessageRelation(undefined, undefined, threadId);
  // The HTML mention renders as the agent's pill, labelled like a mention typed in the composer.
  const room = mx.getRoom(roomId);
  const agentName =
    (room && getMemberDisplayName(room, agentUserId)) ??
    getMxIdLocalPart(agentUserId) ??
    agentUserId;
  await mx.sendMessage(roomId, {
    msgtype: MsgType.Text,
    body: `${agentUserId} ${COMPUTER_CONTINUATION_TEXT}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<a href="https://matrix.to/#/${encodeURIComponent(
      agentUserId
    )}">${sanitizeText(agentName)}</a> ${COMPUTER_CONTINUATION_TEXT}`,
    'm.mentions': { user_ids: [agentUserId] },
    ...(relation ? { 'm.relates_to': relation } : {}),
  });
};
