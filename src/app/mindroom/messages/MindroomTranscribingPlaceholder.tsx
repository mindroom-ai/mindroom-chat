import React from 'react';
import * as css from './MindroomTranscribingPlaceholder.css';
import { MINDROOM_TRANSCRIBING_PLACEHOLDER_BODY } from './transcribingPlaceholder';

export function MindroomTranscribingPlaceholder() {
  return (
    <span className={css.Placeholder} role="status" aria-label="Router agent is transcribing">
      <span className={css.Wave} aria-hidden="true">
        <span className={css.WaveBar} />
        <span className={css.WaveBar} />
        <span className={css.WaveBar} />
      </span>
      <span className={css.Text} aria-hidden="true">
        {MINDROOM_TRANSCRIBING_PLACEHOLDER_BODY}
      </span>
    </span>
  );
}
