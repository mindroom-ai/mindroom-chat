import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassFloating, glassOutline, glassSurface } from '../../ui/styles/Glass.css';

// The bar floats above the composer, as tall as the composer's single text line.
const CAPSULE_MIN_HEIGHT = toRem(40);

// Composer-aligned container shared by voice recording and dictation bars.
export const Container = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockEnd: config.space.S200,
});

// Floating recording bar above the composer card; keeps a line around it when glass is off.
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

export const CapsuleStacked = style([
  Capsule,
  {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: config.space.S100,
  },
]);

export const ControlsRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  inlineSize: '100%',
  minInlineSize: 0,
});

// The waveform takes the squeeze, not the side buttons: WebKit shrinks a button below its icon,
// which turned them into tall slivers with shrunken icons beside a long label.
export const Control = style({
  flexShrink: 0,
});

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
