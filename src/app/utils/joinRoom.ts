import { MatrixError } from 'matrix-js-sdk';
import { ConnectionError } from 'matrix-js-sdk/lib/http-api/errors';

export const JOIN_ROOM_TIMEOUT_MESSAGE = 'Joining the room timed out.';
export const JOIN_ROOM_TIMEOUT_MS = 30_000;

export class JoinRoomTimeoutError extends Error {
  constructor() {
    super(JOIN_ROOM_TIMEOUT_MESSAGE);
    this.name = 'JoinRoomTimeoutError';
  }
}

export const waitForJoinRoom = async <T>(
  request: Promise<T>,
  timeoutMs = JOIN_ROOM_TIMEOUT_MS
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new JoinRoomTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([request, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

export const waitForJoinRoomCompletion = <T>(
  request: Promise<T>,
  onJoined: (value: T) => void | Promise<void>,
  timeoutMs = JOIN_ROOM_TIMEOUT_MS
): Promise<void> => waitForJoinRoom(request.then(onJoined), timeoutMs);

export const isRecoverableJoinRoomError = (error: unknown): boolean => {
  if (error instanceof MatrixError) return false;
  if (error instanceof JoinRoomTimeoutError) return true;
  if (error instanceof ConnectionError) return true;
  if (!(error instanceof Error)) return false;
  return error.name.toLowerCase() === 'networkerror';
};

export const canRetryJoinRoom = (error: unknown): boolean => !isRecoverableJoinRoomError(error);

export const getJoinRoomErrorMessage = (error: unknown): string => {
  if (isRecoverableJoinRoomError(error)) {
    return 'Could not reach the server. Reload the app to restore the connection, then try again.';
  }
  if (error instanceof MatrixError) {
    return error.data.error || 'The server rejected the room join.';
  }
  return 'Failed to join the room. Try again.';
};
