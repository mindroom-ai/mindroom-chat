import { EventType, MatrixEvent } from 'matrix-js-sdk';

export const CALL_FAILURE_CONTENT_KEY = 'chat.mindroom.call_failure';

type CallFailureMarker = {
  version?: unknown;
};

const isCallFailureMarker = (value: unknown): value is CallFailureMarker =>
  typeof value === 'object' && value !== null;

export const getCallFailureNotice = (event: MatrixEvent): string | undefined => {
  if (event.getType() !== EventType.RoomMessage) return undefined;

  const content = event.getContent();
  if (!isCallFailureMarker(content[CALL_FAILURE_CONTENT_KEY])) return undefined;
  if (content.msgtype !== 'm.notice') return undefined;

  const body = content.body;
  return typeof body === 'string' && body.trim() ? body.trim() : undefined;
};
