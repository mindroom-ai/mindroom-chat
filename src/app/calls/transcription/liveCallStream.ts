import { isNotTranscribed, type CallEvent, type TranscriptionClient } from './api';

/** The live stream reconnects after this long, twice as long after each failure, up to the most. */
const STREAM_RETRY_MS = 1_000;
const STREAM_RETRY_MAX_MS = 30_000;
/** MindRoom writes to the stream at least every 20 s; quiet for this long, it is lost. */
const STREAM_IDLE_MS = 45_000;

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
export const sleep = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Follows a room's live call events until `signal` aborts, reconnecting with backoff whenever the
 * stream drops (`onLost`); a `ready` starts the backoff over. Resolves `not-transcribed` as soon as
 * MindRoom says the room is not transcribed (404 or 403), and undefined once aborted.
 */
export const followCallEvents = async (
  client: TranscriptionClient,
  roomId: string,
  signal: AbortSignal,
  onEvent: (event: CallEvent) => void,
  onLost?: () => void
): Promise<'not-transcribed' | undefined> => {
  let failures = 0;
  while (!signal.aborted) {
    try {
      await client.events(
        roomId,
        (event) => {
          if (event.type === 'ready') failures = 0;
          onEvent(event);
        },
        signal,
        STREAM_IDLE_MS
      );
    } catch (error) {
      if (signal.aborted) return undefined;
      if (isNotTranscribed(error)) return 'not-transcribed';
    }
    onLost?.();
    const wait = Math.min(STREAM_RETRY_MS * 2 ** failures, STREAM_RETRY_MAX_MS);
    failures += 1;
    if (!(await sleep(wait, signal))) return undefined;
  }
  return undefined;
};
