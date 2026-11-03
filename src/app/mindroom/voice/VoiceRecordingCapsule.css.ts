import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The recording bar that takes the composer's place: discard, waveform, timer, pause.
export const Capsule = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  flex: '1 1 auto',
  minWidth: 0,








  flexShrink: 0,
  minWidth: '3.5ch',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'end',
});

// Announces recording state changes to screen readers without showing them.
export const HiddenStatus = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
