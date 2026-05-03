import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Capsule = style([
  DefaultReset,
  {
    display: 'grid',
    gridTemplateColumns: `${toRem(36)} minmax(0, 1fr) minmax(${toRem(64)}, max-content) auto`,
    alignItems: 'center',
    columnGap: config.space.S100,
    rowGap: config.space.S100,
    width: '100%',
    maxWidth: '100%',
    minHeight: toRem(44),
    padding: config.space.S100,
    borderRadius: config.radii.R400,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
    '@media': {
      '(min-width: 361px)': {
        columnGap: config.space.S200,
        padding: `${config.space.S100} ${config.space.S200}`,
      },
      '(max-width: 360px)': {
        gridTemplateColumns: `${toRem(36)} minmax(0, 1fr) minmax(${toRem(64)}, max-content)`,
      },
    },
  },
]);

export const WaveformSlot = style({
  minWidth: 0,
});

export const Time = style({
  minWidth: toRem(64),
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  '@media': {
    '(max-width: 360px)': {
      gridColumn: '3 / 4',
    },
  },
});

export const Controls = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifySelf: 'end',
  gap: config.space.S100,
  minWidth: 'max-content',
  '@media': {
    '(max-width: 360px)': {
      gridColumn: '2 / 4',
    },
  },
});

export const Audio = style({
  display: 'none',
});
