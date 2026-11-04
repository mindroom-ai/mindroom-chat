import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';

/**
 * Whether `event` is encrypted and not readable yet: its decryption is running, has not started,
 * or failed. A failure is not final, since the SDK decrypts the event again when its room key
 * arrives later (to-device lag, a forwarded key, the key backup).
 */
export const isAwaitingDecryption = (event: MatrixEvent): boolean =>
  event.isBeingDecrypted() || event.shouldAttemptDecryption() || event.isDecryptionFailure();

/** The encrypted events a listener waits for, each until it decrypts or its time runs out. */
export type DecryptionWaits = {
  /**
   * Calls `onDecrypted` once an attempt to decrypt `event` succeeds. A failed attempt also
   * announces itself as decrypted, so the wait goes on after one, until `timeoutMs` passes. An
   * event already waited for, a wait with no time left, and a wait after `stop` do nothing.
   */
  wait: (event: MatrixEvent, timeoutMs: number, onDecrypted: () => void) => void;
  /** Ends every wait without calling anything, for good: the listener's view or account went. */
  stop: () => void;
};

export const createDecryptionWaits = (): DecryptionWaits => {
  const pending = new Map<MatrixEvent, () => void>();
  let stopped = false;

  const wait: DecryptionWaits['wait'] = (event, timeoutMs, onDecrypted) => {
    if (stopped || timeoutMs <= 0 || pending.has(event)) return;
    const onAttempt = () => {
      if (event.isDecryptionFailure()) return;
      end();
      onDecrypted();
    };
    const timer = setTimeout(() => end(), timeoutMs);
    const end = () => {
      clearTimeout(timer);
      event.removeListener(MatrixEventEvent.Decrypted, onAttempt);
      pending.delete(event);
    };
    event.on(MatrixEventEvent.Decrypted, onAttempt);
    pending.set(event, end);
  };

  const stop = () => {
    stopped = true;
    [...pending.values()].forEach((end) => end());
  };

  return { wait, stop };
};
