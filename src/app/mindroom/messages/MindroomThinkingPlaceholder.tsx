import { useTranslation } from 'react-i18next';
import React from 'react';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useClientConfig } from '../../hooks/useClientConfig';
import * as css from './MindroomThinkingPlaceholder.css';
import { resolveMindroomThinkingPlaceholderMessages } from './thinkingPlaceholder';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from './thinkingPlaceholder';
import thinkingBase from './thinking-mark-base.svg';
import thinkingCore from './thinking-mark-core.svg';

const ROTATION_INTERVAL_MS = 3600;
const TENTH_MS = 100;

const getElapsedTenths = (elapsedMs: number) => Math.max(0, Math.floor(elapsedMs / TENTH_MS));

/**
 * Seconds since the reply arrived, in tenths. Its own component, outside the shimmer layers,
 * so each tick re-renders and repaints only this text.
 */
function ThinkingElapsed({ startedAt }: { startedAt: number }) {
  const language = useAppLanguageCode();
  const [tenths, setTenths] = React.useState(() => getElapsedTenths(Date.now() - startedAt));
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
    let timeoutId: ReturnType<typeof globalThis.setTimeout>;
    // Wake at each next tenth, so a late timer never shows one tenth twice and skips the next.
    // A server clock ahead of the viewer's holds the count at zero until it catches up.
    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      setTenths(getElapsedTenths(elapsedMs));
      timeoutId = globalThis.setTimeout(
        tick,
        elapsedMs < 0 ? -elapsedMs : TENTH_MS - (elapsedMs % TENTH_MS)
      );
    };
    tick();

    return () => globalThis.clearTimeout(timeoutId);
  }, [startedAt]);

  return (
    <span className={css.Elapsed} aria-hidden="true">
      ({formatter.format(tenths / 10)})
    </span>
  );
}

type MindroomThinkingPlaceholderProps = {
  /** When the reply arrived, in milliseconds since the epoch; shows a counter from it. */
  startedAt?: number;
};

export function MindroomThinkingPlaceholder({ startedAt }: MindroomThinkingPlaceholderProps) {
  const { t } = useTranslation();
  const clientConfig = useClientConfig();
  const messages = React.useMemo(
    () =>
      resolveMindroomThinkingPlaceholderMessages(
        clientConfig.mindroom?.thinkingPlaceholderMessages
      ),
    [clientConfig.mindroom?.thinkingPlaceholderMessages]
  );
  const [messageIndex, setMessageIndex] = React.useState(0);

  React.useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, ROTATION_INTERVAL_MS);

    return () => globalThis.clearInterval(intervalId);
  }, [messages.length]);

  const configuredMessage = messages[messageIndex % messages.length];
  const message =
    configuredMessage === MINDROOM_THINKING_PLACEHOLDER_BODY
      ? t('mindroomUi.messages.mindroomThinkingPlaceholder.thinking')
      : configuredMessage;

  return (
    <span
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
      <span className={css.Text} aria-hidden="true">
        <span className={css.TextBase}>{message}</span>
        <span className={css.TextSweep} aria-hidden="true">
          <span className={css.TextCounter}>
            <span className={css.TextHighlight}>{message}</span>
          </span>
        </span>
      </span>
      {startedAt !== undefined && <ThinkingElapsed startedAt={startedAt} />}
    </span>
  );
}
