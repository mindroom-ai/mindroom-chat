import { useEffect, useState } from 'react';
import { EventTimelineSetHandlerMap, MatrixClient, MatrixEvent, RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { getCallFailureNotice } from './callFailureNotice';

export type CallFailureNotice = {
  eventId: string;
  message: string;
};

const RECENT_NOTICE_WINDOW_MS = 60_000;

const decryptEvent = async (event: MatrixEvent, mx: MatrixClient): Promise<boolean> => {
  if (!event.isEncrypted()) return true;

  try {
    await mx.decryptEventIfNeeded(event);
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
    let latestEventTs = 0;
    const inspectEvent = async (event: MatrixEvent): Promise<boolean> => {
      if (!active || !(await decryptEvent(event, mx))) return false;

      const message = getCallFailureNotice(event, mx.getUserId() ?? undefined);
      if (!message || !active) return false;
      const eventTs = event.getTs();
      if (eventTs <= latestEventTs) return false;

      latestEventTs = eventTs;
      setNotice({ eventId: event.getId() ?? `${eventTs}:${message}`, message });
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
        if (!active) return;
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
