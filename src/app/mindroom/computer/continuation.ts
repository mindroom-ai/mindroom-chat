import { MsgType, type MatrixClient } from 'matrix-js-sdk';
import { getMessageRelation } from '../threads/composeMessageRelation';

export const COMPUTER_CONTINUATION_TEXT = 'The computer is available again. Please continue.';

export const sendComputerContinuation = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string | undefined,
  agentUserId: string
): Promise<void> => {
  const relation = getMessageRelation(undefined, undefined, threadId);
  await mx.sendMessage(roomId, {
    msgtype: MsgType.Text,
    body: `${agentUserId} ${COMPUTER_CONTINUATION_TEXT}`,
    'm.mentions': { user_ids: [agentUserId] },
    ...(relation ? { 'm.relates_to': relation } : {}),
  });
};
