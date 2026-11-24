import {
  Direction,
  type IEvent,
  type MatrixClient,
  MatrixError,
  RelationType,
} from 'matrix-js-sdk';
import { isVisibleThreadReplyEventType } from '../../event-store/threads/threadUtils';

/** Where a time lands in a room: an event, or why there is none to show. */
export type TimeLookup =
  | { kind: 'found'; eventId: string }
  | { kind: 'unsupported' }
  | { kind: 'notFound' };

const errcodeOf = (error: unknown): string | undefined =>
  error instanceof MatrixError ? error.errcode : undefined;

// A server without `/timestamp_to_event` (Matrix spec v1.6, MSC3030) answers M_UNRECOGNIZED,
// or 405 for a path it routes but not for GET, also after the SDK tried the unstable prefix.
const lacksEndpoint = (error: unknown): boolean =>
  errcodeOf(error) === 'M_UNRECOGNIZED' ||
  (error instanceof MatrixError && error.httpStatus === 405);

const noEvent = (error: unknown): boolean => errcodeOf(error) === 'M_NOT_FOUND';

/**
 * The event the room shows at `timestamp`: the first one sent then or later, or when nothing
 * came after it, the last one before it. Other failures reject, with the server's error.
 */
export const findEventAtTime = async (
  mx: Pick<MatrixClient, 'timestampToEvent'>,
  roomId: string,
  timestamp: number
): Promise<TimeLookup> => {
  const lookUp = async (direction: Direction): Promise<TimeLookup> => {
    const { event_id: eventId } = await mx.timestampToEvent(roomId, timestamp, direction);
    return { kind: 'found', eventId };
  };
  try {
    return await lookUp(Direction.Forward);
  } catch (error) {
    if (lacksEndpoint(error)) return { kind: 'unsupported' };
    if (!noEvent(error)) throw error;
  }
  try {
    return await lookUp(Direction.Backward);
  } catch (error) {
    if (noEvent(error)) return { kind: 'notFound' };
    throw error;
  }
};

/** Replies per page while a thread is read newest first. */
const THREAD_PAGE_SIZE = 100;
/** One deadline for all pages, including a server that never answers. */
const THREAD_LOOKUP_TIMEOUT_MS = 15_000;

/** A reply the thread shows as a row: a message, approval or sticker that was not deleted. */
const shownReply = (raw: Partial<IEvent>): boolean =>
  isVisibleThreadReplyEventType(raw.type) && !raw.unsigned?.redacted_because;

/**
 * The message a thread shows at `timestamp`, by the room's rule: its first reply sent then or
 * later, or when every reply came before the time, its newest reply. A time before the first
 * reply that is not after the thread's first message (`rootTs`), or a thread without replies,
 * lands on that first message, the root (`threadId`). The replies are read newest first, a page at
 * a time, until one is older than the time. Known boundary answers need no server request.
 * Server pagination shares one deadline; a timed-out page cannot resume the search.
 */
export const findThreadEventAtTime = async (
  mx: Pick<MatrixClient, 'fetchRelations'>,
  roomId: string,
  threadId: string,
  timestamp: number,
  rootTs: number | undefined,
  newestKnownReply?: { eventId: string; ts: number }
): Promise<string> => {
  if (rootTs !== undefined && timestamp <= rootTs) return threadId;
  if (newestKnownReply && timestamp > newestKnownReply.ts) return newestKnownReply.eventId;

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DOMException('Thread time lookup timed out', 'TimeoutError')),
      THREAD_LOOKUP_TIMEOUT_MS
    );
  });
  let newest: string | undefined;
  let atOrAfter: string | undefined;
  let from: string | undefined;
  try {
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await Promise.race([
        mx.fetchRelations(roomId, threadId, RelationType.Thread, null, {
          dir: Direction.Backward,
          limit: THREAD_PAGE_SIZE,
          ...(from ? { from } : {}),
        }),
        deadline,
      ]);
      for (const raw of page.chunk) {
        if (shownReply(raw)) {
          newest ??= raw.event_id;
          if (raw.origin_server_ts < timestamp) return atOrAfter ?? newest;
          atOrAfter = raw.event_id;
        }
      }
      from = page.next_batch;
    } while (from);
    if (!atOrAfter || rootTs === undefined || timestamp <= rootTs) return threadId;
    return atOrAfter;
  } finally {
    clearTimeout(timer!);
  }
};
