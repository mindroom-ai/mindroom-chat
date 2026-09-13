import React from 'react';
import * as css from './StreamingIndicator.css';

export function StreamingIndicator() {
  return (
    <span className={css.Container} role="status" aria-label="AI is responding">
      <span className={css.Dot0} aria-hidden="true" />
      <span className={css.Dot1} aria-hidden="true" />
      <span className={css.Dot2} aria-hidden="true" />
    </span>
  );
}

export const renderMindroomStreamingIndicator = () => <StreamingIndicator />;
