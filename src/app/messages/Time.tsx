import { useEffect, useId, useReducer, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import classNames from 'classnames';
import { Text, as } from 'folds';
import { secondsToMs, timeHourMinute, timeHourMinuteSecond, today, yesterday } from '../lib/time';
import { localDigits } from '../lib/localDigits';
import { subscribeRelativeTimeClock } from '../i18n/useRelativeTime';
import { getReplyTimeParts, type ReplyTiming } from './replyTiming';
import * as css from './Time.css';

type TimeProps = {
  ts: number;
  /** Only the time of day, for compact rows. */
  compact?: boolean;
  hour24Clock?: boolean;
  /** dayjs format for dates before yesterday. */
  dateFormatString?: string;
  /**
   * An agent reply's timing: the time adds the reply's duration ("10:04 · 7m"), and unfolds its
   * finish and exact duration ("10:04 – 10:11 · 7m 12s") on hover, keyboard focus or a tap.
   * Compact rows keep the short form: unfolding would push their text aside.
   */
  timing?: ReplyTiming;
};

/** A part of a reply's time that shows only unfolded. */
function Fold({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={css.Fold} data-reply-time-fold="">
      <span className={classNames(css.FoldText, className)}>{children}</span>
    </span>
  );
}

/**
 * When a message was sent: the time today, "Yesterday", or the date before that. Times and their
 * day period come from Intl; the date takes the user's dayjs format in the language's digits.
 * An agent reply's time also says how long it took, and while it streams counts up every second.
 */
export const Time = as<'time', TimeProps>(
  (
    {
      ts,
      compact,
      hour24Clock = false,
      dateFormatString = 'D MMM YYYY',
      timing,
      className,
      onClick,
      onMouseDown,
      ...props
    },
    ref
  ) => {
    const { t, i18n } = useTranslation();
    const { language } = i18n;
    const [, tick] = useReducer((count: number) => count + 1, 0);
    // Undefined for a stream gone stale, which ticks no more.
    const parts = timing && getReplyTimeParts(timing, Date.now(), { hour24Clock, language });
    const streaming = !!parts && !!timing?.streaming;
    useEffect(
      () => (streaming ? subscribeRelativeTimeClock(secondsToMs(1), tick) : undefined),
      [streaming]
    );
    // A tap opens the folded parts, which have no hover on touch screens, until the next tap or
    // a press anywhere else. The keyboard unfolds them through the message row's focus.
    const [open, setOpen] = useState(false);
    const openId = useId();
    useEffect(() => {
      if (!open) return undefined;
      const closeElsewhere = (evt: PointerEvent) => {
        const pressed =
          evt.target instanceof Element ? evt.target.closest('time[data-open]') : null;
        if (pressed?.getAttribute('data-open') !== openId) setOpen(false);
      };
      document.addEventListener('pointerdown', closeElsewhere, true);
      return () => document.removeEventListener('pointerdown', closeElsewhere, true);
    }, [open, openId]);

    const time = timeHourMinute(ts, hour24Clock, language);
    const dateOf = (at: number) => localDigits(dayjs(at).format(dateFormatString), language);
    const stamp = (at: number) =>
      `${dateOf(at)} ${timeHourMinuteSecond(at, hour24Clock, language)}`;
    let label = time;
    if (!compact && !today(ts)) {
      label = yesterday(ts)
        ? t('sharedUi.time.yesterdayValue1', { value1: time })
        : `${dateOf(ts)} ${time}`;
    }

    if (!timing || !parts) {
      return (
        <Text
          as="time"
          size="T200"
          priority="300"
          dateTime={new Date(ts).toISOString()}
          title={stamp(ts)}
          className={className}
          onClick={onClick}
          onMouseDown={onMouseDown}
          {...props}
          ref={ref}
        >
          {label}
        </Text>
      );
    }

    const { end, short, tail } = parts;
    const title = [
      t('mindroomUi.messages.replyTime.started', { value1: stamp(ts) }),
      timing.endTs === undefined
        ? t('mindroomUi.messages.replyTime.stillStreaming')
        : t('mindroomUi.messages.replyTime.finished', { value1: stamp(timing.endTs) }),
      t('mindroomUi.messages.replyTime.duration', { value1: `${short}${tail}` }),
    ].join('\n');
    const live = streaming ? css.Live : undefined;
    return (
      <Text
        as="time"
        size="T200"
        priority="300"
        dateTime={new Date(ts).toISOString()}
        title={title}
        {...props}
        className={classNames(css.ReplyTime, className)}
        data-open={!compact && open ? openId : undefined}
        onMouseDown={(evt: MouseEvent<HTMLTimeElement>) => {
          onMouseDown?.(evt);
          // A press leaves the focus where it was: on the row it would show the row's toolbar.
          if (!compact) evt.preventDefault();
        }}
        onClick={(evt: MouseEvent<HTMLTimeElement>) => {
          onClick?.(evt);
          if (!compact) setOpen((shown) => !shown);
        }}
        ref={ref}
      >
        {streaming && <span className={css.Dot} data-reply-time-live="" aria-hidden />}
        {label}
        {!compact && end !== undefined && (
          <Fold>
            {'\u00a0–\u00a0'}
            <span className={live}>{end}</span>
          </Fold>
        )}
        {'\u00a0·\u00a0'}
        <span className={live}>{short}</span>
        {!compact && tail && <Fold className={live}>{tail}</Fold>}
      </Text>
    );
  }
);
