import React from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import * as css from './MindroomThinkingPlaceholder.css';
import { resolveMindroomThinkingPlaceholderMessages } from './thinkingPlaceholder';

const ROTATION_INTERVAL_MS = 3600;

export function MindroomThinkingPlaceholder() {
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

  const message = messages[messageIndex % messages.length];

  return (
    <span className={css.Placeholder} role="status" aria-label="AI is responding">
      <span className={css.Text} aria-hidden="true">
        {message}
      </span>
      <span className={css.Ellipsis} aria-hidden="true">
        ...
      </span>
    </span>
  );
}
