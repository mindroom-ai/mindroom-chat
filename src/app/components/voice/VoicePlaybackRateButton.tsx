import React from 'react';
import { Text } from 'folds';
import { useAtom } from 'jotai';
import {
  cycleVoicePlaybackRate,
  formatVoicePlaybackRate,
  voiceMessagePlaybackRateAtom,
} from '../../state/voiceMessageSettings';
import * as css from './VoicePlaybackRateButton.css';

export function VoicePlaybackRateButton() {
  const [rate, setRate] = useAtom(voiceMessagePlaybackRateAtom);
  const label = formatVoicePlaybackRate(rate);

  return (
    <button
      className={css.Button}
      type="button"
      aria-label={`Playback speed, currently ${label}, click to cycle`}
      onClick={() => setRate(cycleVoicePlaybackRate(rate))}
    >
      <Text as="span" className={css.Label} size="B300">
        {label}
      </Text>
    </button>
  );
}

export function VoicePlaybackRatePlaceholder() {
  return (
    <div className={css.Placeholder} aria-hidden="true">
      <Text as="span" className={css.Label} size="B300">
        1.5×
      </Text>
    </div>
  );
}
