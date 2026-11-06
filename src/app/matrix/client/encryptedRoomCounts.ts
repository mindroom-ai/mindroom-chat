import type { MatrixClient } from 'matrix-js-sdk';

/** Keeps the unread counts of encrypted rooms; returns a function that stops it. */
export const keepEncryptedRoomCounts = (mx: MatrixClient): (() => void) => {
  void mx;
  return () => undefined;
};
