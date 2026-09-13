import { MatrixEvent } from 'matrix-js-sdk';
import { MessageEvent } from '../../../types/matrix/room';

const getThreadEditBackfillPhase = (threadTailLoaded: boolean): number =>
  threadTailLoaded ? 1 : 0;

export const shouldFetchThreadEditBackfill = (
  mEvent: MatrixEvent,
  attemptedEvents: WeakMap<MatrixEvent, number>,
  threadTailLoaded: boolean
): boolean => {
  if (!mEvent.getId()) return false;
  if (mEvent.isRedacted()) return false;
  if (mEvent.replacingEvent() && !threadTailLoaded) return false;

  const currentPhase = getThreadEditBackfillPhase(threadTailLoaded);
  const lastAttemptPhase = attemptedEvents.get(mEvent);
  if (typeof lastAttemptPhase === 'number' && lastAttemptPhase >= currentPhase) return false;

  const eventType = mEvent.getType();
  return (
    eventType === MessageEvent.RoomMessage ||
    eventType === MessageEvent.RoomMessageEncrypted
  );
};

export const markThreadEditBackfillAttempted = (
  mEvent: MatrixEvent,
  attemptedEvents: WeakMap<MatrixEvent, number>,
  threadTailLoaded: boolean
): void => {
  attemptedEvents.set(mEvent, getThreadEditBackfillPhase(threadTailLoaded));
};
