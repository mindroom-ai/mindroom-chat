import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Root = style({
  width: toRem(400),
  maxWidth: '100%',
  minWidth: 0,
});

export const Capsule = style([
  DefaultReset,
  {
    display: 'grid',
    gridTemplateColumns: `${toRem(44)} minmax(0, 1fr) ${toRem(44)} ${toRem(24)}`,
    gridTemplateRows: `${toRem(32)} ${toRem(16)} auto`,
    gridTemplateAreas: '"play wave rate more" "play time rate more" "error error error error"',
    alignItems: 'center',
    columnGap: config.space.S200,
    width: '100%',
    minWidth: 0,
    padding: config.space.S200,
    borderRadius: toRem(16),
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
    selectors: {
      '&[data-playing="true"]': {
        boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
      },
    },
  },
]);

export const Title = style({
  minWidth: 0,
  fontWeight: config.fontWeight.W500,
  marginBlockEnd: config.space.S100,
  marginInline: config.space.S200,
});

export const PlayCell = style({
  gridArea: 'play',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const PlayButton = style({
  width: toRem(44),
  height: toRem(44),
  flexShrink: 0,
  padding: 0,
  borderRadius: '50%',
});

export const PlayIcon = style({
  transform: 'translateX(1px)',
});

export const WaveformCell = style({
  gridArea: 'wave',
  minWidth: 0,
});

export const Controls = style({
  display: 'contents',
});

export const Time = style({
  gridArea: 'time',
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  fontSize: toRem(12),
  opacity: 0.65,
});

export const RateCell = style({ gridArea: 'rate', display: 'flex', alignItems: 'center' });
export const MoreCell = style({ gridArea: 'more', display: 'flex', alignItems: 'center' });

export const Error = style({
  gridArea: 'error',
  color: color.Critical.Main,
  paddingBlockStart: config.space.S200,
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
