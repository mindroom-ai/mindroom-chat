import { MatrixError } from 'matrix-js-sdk';

/**
 * A failure as a person reads it: a Matrix server's own explanation (`error` in its JSON
 * answer) without the status and URL the SDK adds to the message, or any other error's message.
 */
export const readableReason = (failure: unknown): string => {
  if (
    failure instanceof MatrixError &&
    typeof failure.data.error === 'string' &&
    failure.data.error
  ) {
    return failure.data.error;
  }
  return failure instanceof Error && failure.message ? failure.message : String(failure);
};
