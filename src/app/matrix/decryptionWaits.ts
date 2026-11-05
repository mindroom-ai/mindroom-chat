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
   * announces itself as decrypted, so the wait goes on after one, until `timeoutMs` passes; an
   * attempt still running then, or when the wait starts with no time left, is waited for to its
   * end. An event already waited for and a wait after `stop` do nothing.
   */
  wait: (event: MatrixEvent, timeoutMs: number, onDecrypted: () => void) => void;
  /** Ends every wait without calling anything, for good: the listener's view or account went. */
  stop: () => void;
};

export const createDecryptionWaits = (): DecryptionWaits => {
  const pending = new Map<MatrixEvent, () => void>();
  let stopped = false;

  const wait: DecryptionWaits['wait'] = (event, timeoutMs, onDecrypted) => {
    if (stopped || pending.has(event)) return;
    // Once the time is up, the attempt running then is the last one that counts: a message that
    // arrives old (after a reconnect) is still read once the attempt it arrived with works.
    let timeUp = false;
    const onAttempt = () => {
      if (!event.isDecryptionFailure()) {
        end();
        onDecrypted();
      } else if (timeUp) end();
    };
    const endOfTime = () => {
      timeUp = true;
      if (!event.isBeingDecrypted()) end();
    };
    const timer = timeoutMs > 0 ? setTimeout(endOfTime, timeoutMs) : undefined;
    const end = () => {
      clearTimeout(timer);
      event.removeListener(MatrixEventEvent.Decrypted, onAttempt);
      pending.delete(event);
    };
    event.on(MatrixEventEvent.Decrypted, onAttempt);
    pending.set(event, end);
    if (timer === undefined) endOfTime();
  };

  const stop = () => {
    stopped = true;
    [...pending.values()].forEach((end) => end());
  };

  return { wait, stop };
};
