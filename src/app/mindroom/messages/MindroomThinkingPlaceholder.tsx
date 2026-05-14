import React from 'react';
import * as css from './MindroomThinkingPlaceholder.css';
import { MINDROOM_THINKING_PLACEHOLDER_MESSAGES } from './thinkingPlaceholder';

const ROTATION_INTERVAL_MS = 2400;

export function MindroomThinkingPlaceholder() {
  const [messageIndex, setMessageIndex] = React.useState(0);

  React.useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setMessageIndex((current) => (current + 1) % MINDROOM_THINKING_PLACEHOLDER_MESSAGES.length);
    }, ROTATION_INTERVAL_MS);

    return () => globalThis.clearInterval(intervalId);
  }, []);

  const message = MINDROOM_THINKING_PLACEHOLDER_MESSAGES[messageIndex];

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
