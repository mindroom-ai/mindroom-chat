import { MatrixEvent } from 'matrix-js-sdk';
import { MessageEvent } from '../../../types/matrix/room';

export const shouldFetchMissingThreadEdit = (
  mEvent: MatrixEvent,
  attemptedEvents: WeakSet<MatrixEvent>
): boolean => {
  if (!mEvent.getId()) return false;
  if (attemptedEvents.has(mEvent)) return false;
  if (mEvent.isRedacted()) return false;
  if (mEvent.replacingEvent()) return false;

  const eventType = mEvent.getType();
  return (
    eventType === MessageEvent.RoomMessage ||
    eventType === MessageEvent.RoomMessageEncrypted
  );
};
