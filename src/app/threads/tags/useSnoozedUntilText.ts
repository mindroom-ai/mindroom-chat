import { useTranslation } from 'react-i18next';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useSnoozeNow } from './useSnoozeNow';

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * The wake time as a clock time, with the date unless it is today. Never relative: nothing re-renders
 * this text before the snooze ends, so "in 30m" would go stale.
 */
const formatWakeTime = (untilTs: number, now: number, language: string): string =>
  new Intl.DateTimeFormat(language, {
    ...(isSameDay(new Date(untilTs), new Date(now)) ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(untilTs);

/** "Snoozed until ..." while the snooze lasts; undefined from its time on. */
export const useSnoozedUntilText = (snoozedUntilTs: number | undefined): string | undefined => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const now = useSnoozeNow([snoozedUntilTs]);
  if (snoozedUntilTs === undefined || !isSnoozedAt(snoozedUntilTs, now)) return undefined;
  return t('thread.snoozedUntil', { time: formatWakeTime(snoozedUntilTs, now, language) });
};
