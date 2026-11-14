import { EventType, MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { matchesEnum } from '../../lib/matchesEnum';

export const CALL_FAILURE_CONTENT_KEY = 'chat.mindroom.call_failure';

type CallFailureMarker = {
  version?: unknown;
};

const isCallFailureMarker = (value: unknown): value is CallFailureMarker =>
  typeof value === 'object' && value !== null;

export const getCallFailureNotice = (
  event: MatrixEvent,
  viewerUserId: string | undefined
): string | undefined => {
  if (!matchesEnum(event.getType(), EventType.RoomMessage)) return undefined;
  if (!isMindroomAgentUserIdForViewer(event.getSender(), viewerUserId)) return undefined;

  const content = event.getContent();
  if (!content) return undefined;
  if (!isCallFailureMarker(content[CALL_FAILURE_CONTENT_KEY])) return undefined;
  if (content.msgtype !== 'm.notice') return undefined;

  const body = content.body;
  return typeof body === 'string' && body.trim() ? body.trim() : undefined;
};
