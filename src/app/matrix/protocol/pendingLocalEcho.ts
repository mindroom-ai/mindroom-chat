import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';

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

export const isFailedLocalEchoStatus = (status: unknown): boolean =>
  status === EventStatus.NOT_SENT;

export const isFailedLocalEchoEvent = (event?: Pick<MatrixEvent, 'status'> | null): boolean =>
  isFailedLocalEchoStatus(event?.status);

/**
 * The transaction ID to send an event under: `kept` when the caller keeps one for the event, so
 * that sending it again after a crash is the same event to the server. A room never forgets an ID
 * that had a local echo, also a cancelled one, and refuses a second echo under it, so an attempt
 * that follows a failed one in the same page gets a fresh ID.
 */
export const txnIdToSendUnder = (mx: MatrixClient, room: Room, kept: string | undefined): string =>
  kept && !room.getEventForTxnId(kept) ? kept : mx.makeTxnId();

/** Removes a local echo that failed to send, so it can no longer be resent. */
export const discardFailedLocalEcho = (mx: MatrixClient, event: MatrixEvent | undefined): void => {
  if (event && isFailedLocalEchoEvent(event)) mx.cancelPendingEvent(event);
};
