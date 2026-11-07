import { isNotTranscribed, type LiveCall, type TranscriptionClient } from './api';

/** A read of the live call gives up after this long, and counts as failed. */
const READ_TIMEOUT_MS = 10_000;

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
 * Reads the room's live call every `everyMs` until `signal` aborts, handing on each read. Each read
 * asks only for the lines after the last one read, and the first after `from`, the last line that
 * earlier reads read; MindRoom answers all of a new call's lines for a line of another call. A read
 * that fails or takes longer than 10 seconds is reported (`onFailure`) and the next one tries again.
 * Resolves `not-transcribed` as soon as MindRoom says the room is not transcribed (404 or 403), and
 * undefined once aborted.
 */
export const pollLiveCall = async (
  client: Pick<TranscriptionClient, 'live'>,
  roomId: string,
  everyMs: number,
  signal: AbortSignal,
  onLive: (live: LiveCall) => void,
  onFailure?: (error: unknown) => void,
  from?: string
): Promise<'not-transcribed' | undefined> => {
  let after = from;
  do {
    const read = new AbortController();
    const giveUp = () => read.abort();
    const timer = setTimeout(giveUp, READ_TIMEOUT_MS);
    signal.addEventListener('abort', giveUp, { once: true });
    try {
      const live = await client.live(roomId, after, read.signal);
      if (signal.aborted) return undefined;
      after = live.lines[live.lines.length - 1]?.id ?? after;
      onLive(live);
    } catch (error) {
      if (signal.aborted) return undefined;
      if (isNotTranscribed(error)) return 'not-transcribed';
      onFailure?.(error);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', giveUp);
    }
  } while (await sleep(everyMs, signal));
  return undefined;
};
