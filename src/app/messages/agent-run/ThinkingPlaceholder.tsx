import { useTranslation } from 'react-i18next';
import React from 'react';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useClientConfig } from '../../config/useClientConfig';
import {
  useActiveWhenVisible,
  usePauseAnimationWhenHidden,
} from '../../lib/hooks/usePauseWhenHidden';
import * as css from './ThinkingPlaceholder.css';
import { ShimmerText } from './ShimmerText';
import {
  MINDROOM_THINKING_PLACEHOLDER_BODY,
  resolveThinkingPlaceholderMessages,
} from '../../matrix/protocol/thinkingPlaceholder';
import thinkingBase from './thinking-mark-base.svg';
import thinkingCore from './thinking-mark-core.svg';

const ROTATION_INTERVAL_MS = 3600;
const TENTH_MS = 100;

const getElapsedTenths = (elapsedMs: number) => Math.max(0, Math.floor(elapsedMs / TENTH_MS));

/**
 * Seconds since the reply arrived, in tenths, or undefined without a timestamp. The label
 * carries it, so it shares the label's weight, gradient and shimmer.
 */
function useThinkingElapsed(startedAt: number | undefined, active: boolean): string | undefined {
  const language = useAppLanguageCode();
  const [tenths, setTenths] = React.useState(() =>
    startedAt === undefined ? 0 : getElapsedTenths(Date.now() - startedAt)
  );
  const formatter = React.useMemo(
    () =>
      new Intl.NumberFormat(language, {
        style: 'unit',
        unit: 'second',
        unitDisplay: 'narrow',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [language]
  );

  React.useEffect(() => {
    if (startedAt === undefined || !active) return undefined;
    let timeoutId: ReturnType<typeof globalThis.setTimeout>;
    // Wake at each next tenth, so a late timer never shows one tenth twice and skips the next.
    // A server clock ahead of the viewer's holds the count at zero until it catches up; the
    // remainder is then negative, so each wait stays under two tenths, however far ahead.
    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      setTenths(getElapsedTenths(elapsedMs));
      timeoutId = globalThis.setTimeout(tick, TENTH_MS - (elapsedMs % TENTH_MS));
    };
    tick();

    return () => globalThis.clearTimeout(timeoutId);
  }, [active, startedAt]);

  return startedAt === undefined ? undefined : formatter.format(tenths / 10);
}

/** Isolated leaf for the 100 ms elapsed timer and 3.6 s rotating copy so ticks skip the indicator. */
const ThinkingPlaceholderLabel = React.memo(function ThinkingPlaceholderLabel({
  startedAt,
  active,
}: {
  startedAt: number | undefined;
  active: boolean;
}) {
  const { t } = useTranslation();
  const clientConfig = useClientConfig();
  const messages = React.useMemo(
    () => resolveThinkingPlaceholderMessages(clientConfig.mindroom?.thinkingPlaceholderMessages),
    [clientConfig.mindroom?.thinkingPlaceholderMessages]
  );
  const [messageIndex, setMessageIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active) return undefined;
    const intervalId = globalThis.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, ROTATION_INTERVAL_MS);

    return () => globalThis.clearInterval(intervalId);
  }, [active, messages.length]);

  const configuredMessage = messages[messageIndex % messages.length];
  const message =
    configuredMessage === MINDROOM_THINKING_PLACEHOLDER_BODY
      ? t('mindroomUi.messages.mindroomThinkingPlaceholder.thinking')
      : configuredMessage;
  const elapsed = useThinkingElapsed(startedAt, active);
  const text = elapsed === undefined ? message : `${message} (${elapsed})`;

  return <ShimmerText>{text}</ShimmerText>;
});

type ThinkingPlaceholderProps = {
  /** When the reply arrived, in milliseconds since the epoch; shows a counter from it. */
  startedAt?: number;
};

export function ThinkingPlaceholder({ startedAt }: ThinkingPlaceholderProps) {
  const { t } = useTranslation();
  const ref = React.useRef<HTMLSpanElement>(null);
  usePauseAnimationWhenHidden(ref);
  const active = useActiveWhenVisible(ref);

  return (
    <span
      ref={ref}
      className={css.Placeholder}
      role="status"
      aria-label={t('mindroomUi.messages.mindroomThinkingPlaceholder.aiIsResponding')}
    >
      <span className={css.Indicator} aria-hidden="true">
        <span className={css.Aura} />
        <span className={css.Rotor}>
          <img className={css.Mark} src={thinkingBase} alt="" draggable={false} />
          <span className={css.Core}>
            <img className={css.Mark} src={thinkingCore} alt="" draggable={false} />
          </span>
        </span>
      </span>
      <ThinkingPlaceholderLabel startedAt={startedAt} active={active} />
    </span>
  );
}
