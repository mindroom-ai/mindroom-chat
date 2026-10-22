import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { inSameDay } from '../../utils/time';
import { userDisplayName } from '../messages/approvalPeople';
import { usePageResume } from '../threads/usePageResume';
import { openYoloWindowsInThread } from './yoloContract';
import { useRoomYoloWindows } from './useRoomYoloWindows';
import * as css from './YoloWindowChips.css';

// setTimeout fires at once past this many milliseconds, so a later end is reached in steps.
const MAX_TIMER_MS = 2_147_483_647;

/** When a window ends, in the viewer's clock format, with the day when that is not today. */
const formatEnd = (expiresAt: number, now: number, language: string, hour24Clock: boolean) =>
  new Date(expiresAt).toLocaleString(language, {
    weekday: inSameDay(expiresAt, now) ? undefined : 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: !hour24Clock,
  });

/** Says in a thread's header whose tool calls there run without approval cards, and until when. */
export function YoloWindowChips({ room, threadId }: { room: Room; threadId: string }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [now, setNow] = useState(Date.now);
  const windows = openYoloWindowsInThread(useRoomYoloWindows(room), threadId, now);
  const nextEnd = windows[0]?.expiresAt;

  // Timers can stop while a device sleeps, so a window that ended meanwhile goes as the page comes back.
  usePageResume(useCallback(() => setNow(Date.now()), []));
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
          time: formatEnd(expiresAt, now, language, hour24Clock),
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
