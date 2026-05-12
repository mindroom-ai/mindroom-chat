import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Root = style({
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
});

export const Capsule = style([
  DefaultReset,
  {
    display: 'grid',
    gridTemplateColumns: `${toRem(36)} minmax(${toRem(96)}, 1fr) auto auto auto auto`,
    gridTemplateAreas: '"play wave time volume rate more"',
    alignItems: 'center',
    gap: config.space.S200,
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    minHeight: toRem(44),
    padding: `${config.space.S100} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
    '@media': {
      '(max-width: 360px)': {
        gridTemplateColumns: `${toRem(36)} minmax(${toRem(96)}, 1fr) auto auto auto`,
        gridTemplateAreas: '"play wave volume rate more" ". time time time time"',
        rowGap: config.space.S100,
      },
      '(max-width: 300px)': {
        gridTemplateColumns: `${toRem(36)} minmax(0, 1fr) auto auto`,
        gridTemplateAreas: '"play wave volume more" ". time rate rate"',
      },
    },
  },
]);

export const PlayCell = style({
  gridArea: 'play',
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
});

export const WaveformCell = style({
  gridArea: 'wave',
  minWidth: 0,
});

export const Time = style({
  gridArea: 'time',
  minWidth: 0,
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  whiteSpace: 'nowrap',
});

export const VolumeCell = style({
  gridArea: 'volume',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
});

export const RateCell = style({
  gridArea: 'rate',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
});

export const MoreCell = style({
  gridArea: 'more',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
});

export const MoreMenu = style({
  width: `min(${toRem(260)}, calc(100vw - ${config.space.S400}))`,
  padding: config.space.S200,
});

export const MoreMenuAction = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  padding: `${config.space.S100} ${config.space.S100} ${config.space.S200}`,
});

export const MoreMenuMeta = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(64)} minmax(0, 1fr)`,
  alignItems: 'baseline',
  gap: config.space.S200,
  padding: `${config.space.S100}`,
});

export const MoreMenuMetaLabel = style({
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P500,
});

export const MoreMenuMetaValue = style({
  minWidth: 0,
  color: color.Surface.OnContainer,
});

export const Audio = style({
  display: 'none',
});
