import { EventStatus, MsgType, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import {
  getMindroomThreadSummaryInfo,
  THREAD_SUMMARY_METADATA_KEY,
} from '../messages/threadSummary';
import { createSessionId } from '../../state/sessions';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { getMessageRelation } from './composeMessageRelation';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { storeThreadSummaryInState } from './threadSummaryState';

export const normalizeSummaryText = (text: string): string => text.replace(/\s+/g, ' ').trim();
export const SUMMARY_MAX_LENGTH = 300;

const sendThreadAction = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  content: RoomMessageEventContent
) => {
  const txnId = mx.makeTxnId();
  try {
    await mx.sendMessage(room.roomId, threadId, content, txnId);
  } catch (error) {
    const event = room.getEventForTxnId(txnId);
    if (event?.status === EventStatus.NOT_SENT) mx.cancelPendingEvent(event);
    throw error;
  }
};

const validateTarget = (mx: MatrixClient, room: Room, threadId: string) => {
  if (!isConfirmedMatrixEventId(threadId) || !getResolvableThreadRootEvent(room, threadId)) {
    throw new Error('A confirmed thread is required.');
  }
  if (
    room.getMyMembership() !== 'join' ||
    !room.currentState.maySendEvent('m.room.message', mx.getSafeUserId())
  ) {
    throw new Error('You cannot send messages in this room.');
  }
};

export const saveThreadSummary = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  text: string
): Promise<void> => {
  validateTarget(mx, room, threadId);
  const summary = normalizeSummaryText(text);
  if (!summary || Array.from(summary).length > SUMMARY_MAX_LENGTH) {
    throw new Error('Summary must contain between 1 and 300 characters.');
  }
  const content = {
    msgtype: MsgType.Notice,
    body: summary,
    'm.relates_to': getMessageRelation(undefined, undefined, threadId),
    [THREAD_SUMMARY_METADATA_KEY]: {
      version: 1,
      summary,
      generated_at: new Date().toISOString(),
      model: 'manual',
    },
  };
  await sendThreadAction(mx, room, threadId, content as RoomMessageEventContent);
  // A first summary can precede SDK thread hydration. Publish the accepted
  // notice through the same state/cache used by the overview and thread banner.
  storeThreadSummaryInState(
    createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()),
    room.roomId,
    threadId,
    getMindroomThreadSummaryInfo(content)
  );
};

export const requestThreadSummary = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  agentId: string
): Promise<void> => {
  validateTarget(mx, room, threadId);
  if (!isMindroomAgentUserId(agentId) || room.getMember(agentId)?.membership !== 'join') {
    throw new Error('Choose an agent that is joined to this room.');
  }
  await sendThreadAction(mx, room, threadId, {
    msgtype: MsgType.Text,
    body: `${agentId} Please regenerate a concise, plain-text summary of this thread (at most 300 characters). Use set_thread_summary with pin=false to update the thread summary. If that tool is unavailable, tell me.`,
    'm.mentions': { user_ids: [agentId] },
    'm.relates_to': getMessageRelation(undefined, undefined, threadId),
  });
};
