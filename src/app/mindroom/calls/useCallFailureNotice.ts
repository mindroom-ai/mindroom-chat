import { useEffect, useState } from 'react';
import { EventTimelineSetHandlerMap, MatrixEvent, RoomEvent } from 'matrix-js-sdk';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { getCallFailureNotice } from './callFailureNotice';

type CallFailureNotice = {
  eventId: string;
  message: string;
};

const RECENT_NOTICE_WINDOW_MS = 60_000;

const decryptEvent = async (event: MatrixEvent, crypto: CryptoBackend): Promise<boolean> => {
  if (!event.isEncrypted()) return true;

  try {
    if (!event.isBeingDecrypted()) {
      await event.attemptDecryption(crypto);
    }
    await event.getDecryptionPromise();
    return !event.isDecryptionFailure();
  } catch {
    return false;
  }
};

export const useCallFailureNotice = (joined: boolean): CallFailureNotice | undefined => {
  const mx = useMatrixClient();
  const room = useRoom();
  const [notice, setNotice] = useState<CallFailureNotice>();

  useEffect(() => {
    setNotice(undefined);
    if (!joined) return undefined;

    let active = true;
    const inspectEvent = async (event: MatrixEvent): Promise<boolean> => {
      const crypto = mx.getCrypto() as CryptoBackend | undefined;
      if (event.isEncrypted() && (!crypto || !(await decryptEvent(event, crypto)))) return false;

      const message = getCallFailureNotice(event);
      if (!message || !active) return false;
      setNotice({ eventId: event.getId() ?? `${event.getTs()}:${message}`, message });
      return true;
    };
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = async (
      event,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (
        !active ||
        data?.liveEvent !== true ||
        toStartOfTimeline ||
        removed ||
        eventRoom?.roomId !== room.roomId
      ) {
        return;
      }

      await inspectEvent(event);
    };

    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    const recentCutoff = Date.now() - RECENT_NOTICE_WINDOW_MS;
    const recentEvents = room
      .getLiveTimeline()
      .getEvents()
      .filter((event) => event.getTs() >= recentCutoff)
      .reverse();
    void (async () => {
      for (const event of recentEvents) {
        if (await inspectEvent(event)) return;
      }
    })();

    return () => {
      active = false;
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [joined, mx, room]);

  return notice;
};
