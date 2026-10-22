import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { userDisplayName } from '../messages/approvalPeople';
import { openYoloWindowsInThread } from './yoloContract';
import { useRoomYoloWindows } from './useRoomYoloWindows';
import * as css from './YoloWindowChips.css';

// setTimeout fires at once past this many milliseconds, so a later end is reached in steps.
const MAX_TIMER_MS = 2_147_483_647;

/** Says in a thread's header whose tool calls there run without approval cards, and until when. */
export function YoloWindowChips({ room, threadId }: { room: Room; threadId: string }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [now, setNow] = useState(Date.now);
  const windows = openYoloWindowsInThread(useRoomYoloWindows(room), threadId, now);
  const nextEnd = windows[0]?.expiresAt;

  useEffect(() => {
    if (nextEnd === undefined) return undefined;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(MAX_TIMER_MS, nextEnd - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [nextEnd, now]);

  if (windows.length === 0) return null;
  return (
    <>
      {windows.map(({ requesterId, expiresAt }) => {
        const own = requesterId === room.myUserId;
        const values = {
          name: userDisplayName(room, requesterId),
          time: new Date(expiresAt).toLocaleTimeString(language, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        return (
          <span
            key={requesterId}
            className={css.Chip}
            data-thread-status-chip=""
            title={
              own
                ? t('mindroomUi.yolo.ownDetail', values)
                : t('mindroomUi.yolo.otherDetail', values)
            }
          >
            {own ? t('mindroomUi.yolo.ownLabel', values) : t('mindroomUi.yolo.otherLabel', values)}
          </span>
        );
      })}
    </>
  );
}
