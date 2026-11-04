import { Direction, type MatrixClient, MatrixError } from 'matrix-js-sdk';

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
