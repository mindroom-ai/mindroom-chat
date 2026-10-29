import { useTranslation } from 'react-i18next';
import React from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import * as css from './MindroomThinkingPlaceholder.css';
import { resolveMindroomThinkingPlaceholderMessages } from './thinkingPlaceholder';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from './thinkingPlaceholder';
import thinkingBase from './thinking-mark-base.svg';
import thinkingCore from './thinking-mark-core.svg';

const ROTATION_INTERVAL_MS = 3600;

export function MindroomThinkingPlaceholder() {
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
    </span>
  );
}
