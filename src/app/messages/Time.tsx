import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Text, as } from 'folds';
import { timeHourMinute, timeHourMinuteSecond, today, yesterday } from '../lib/time';
import { localDigits } from '../lib/localDigits';

type TimeProps = {
  ts: number;
  /** Only the time of day, for compact rows. */
  compact?: boolean;
  hour24Clock?: boolean;
  /** dayjs format for dates before yesterday. */
  dateFormatString?: string;
};

/**
 * When a message was sent: the time today, "Yesterday", or the date before that. Times and their
 * day period come from Intl; the date takes the user's dayjs format in the language's digits.
 */
export const Time = as<'time', TimeProps>(
  ({ ts, compact, hour24Clock = false, dateFormatString = 'D MMM YYYY', ...props }, ref) => {
    const { t, i18n } = useTranslation();
    const time = timeHourMinute(ts, hour24Clock, i18n.language);
    const date = localDigits(dayjs(ts).format(dateFormatString), i18n.language);
    let label = time;
    if (!compact && !today(ts)) {
      label = yesterday(ts)
        ? t('sharedUi.time.yesterdayValue1', { value1: time })
        : `${date} ${time}`;
    }

    return (
      <Text
        as="time"
        size="T200"
        priority="300"
        dateTime={new Date(ts).toISOString()}
        title={`${date} ${timeHourMinuteSecond(ts, hour24Clock, i18n.language)}`}
        {...props}
        ref={ref}
      >
        {label}
      </Text>
    );
  }
);
