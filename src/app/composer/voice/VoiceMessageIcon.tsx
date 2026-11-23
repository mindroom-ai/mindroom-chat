import type { IconSrc } from 'folds';

/**
 * Distinct waveform icon for Matrix voice messages when streaming dictation uses the microphone
 * icon. Drawn on folds' 24-unit grid with its 2-unit stroke.
 */
export const VoiceMessageIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
  </g>
);
