import { useTranslation } from 'react-i18next';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatScheduledTime } from '../overview/compactThreadCardUtils';
import { useSnoozeNow } from './useSnoozeNow';

/** "Snoozed until ..." while the snooze lasts; undefined from its time on. */
export const useSnoozedUntilText = (snoozedUntilTs: number | undefined): string | undefined => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const now = useSnoozeNow([snoozedUntilTs]);
  if (snoozedUntilTs === undefined || !isSnoozedAt(snoozedUntilTs, now)) return undefined;
  return t('thread.snoozedUntil', { time: formatScheduledTime(snoozedUntilTs, t, language) });
};
