import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Waveform = style([
  DefaultReset,
  {
    display: 'block',
    width: '100%',
    minWidth: toRem(96),
    height: toRem(32),
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const WaveformSeek = style({
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  ':focus-visible': {
    outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
    outlineOffset: config.space.S100,
  },
});

export const WaveformDimmed = style({
  opacity: config.opacity.P500,
});

export const WaveformCompact = style({
  display: 'flex',
  justifyContent: 'flex-end',
  overflow: 'hidden',
  position: 'relative',
});

export const Svg = style({
  display: 'block',
  width: '100%',
  height: '100%',
});

export const SvgCompact = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineEnd: 0,
  flex: '0 0 auto',
  width: 'auto',
  maxWidth: 'none',
});

export const Bar = style({
  fill: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P400,
});

export const BarActive = style({
  fill: color.Primary.Main,
  opacity: 1,
});
