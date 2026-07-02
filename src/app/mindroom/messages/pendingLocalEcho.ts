import { EventStatus, type MatrixEvent } from 'matrix-js-sdk';

const PENDING_LOCAL_ECHO_STATUSES = new Set<unknown>([
  EventStatus.ENCRYPTING,
  EventStatus.SENDING,
  EventStatus.QUEUED,
  EventStatus.SENT,
]);

export const isPendingLocalEchoStatus = (status: unknown): boolean =>
  PENDING_LOCAL_ECHO_STATUSES.has(status);

export const isPendingLocalEchoEvent = (event?: Pick<MatrixEvent, 'status'> | null): boolean =>
  isPendingLocalEchoStatus(event?.status);
