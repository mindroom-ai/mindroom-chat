import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassFloating, glassOutline, glassSurface } from '../../styles/Glass.css';

// The bar fills the composer row it replaces, as tall as the composer's single text line.
const CAPSULE_MIN_HEIGHT = toRem(40);

// The recording bar that takes the composer's place: discard, waveform, timer, pause.
// It floats like the composer card, and keeps a line around it when glass is turned off.
export const Capsule = style([
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
  glassOutline,
  {
    display: 'flex',
    flex: '1 1 auto',
    alignItems: 'center',
    gap: config.space.S200,
    minWidth: 0,
    minBlockSize: CAPSULE_MIN_HEIGHT,
    borderRadius: config.radii.R400,
    paddingBlock: config.space.S100,
    paddingInline: config.space.S200,
  },
  { color: color.SurfaceVariant.OnContainer },
]);

// Digits of equal width keep the elapsed time from jittering as it counts up.
export const Timer = style({
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'end',
  minInlineSize: '3.5ch',
  flex: 'none',
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
