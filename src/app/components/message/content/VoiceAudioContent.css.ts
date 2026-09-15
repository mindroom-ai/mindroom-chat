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
    gridTemplateColumns: `${toRem(48)} minmax(0, 1fr)`,
    gridTemplateAreas: '"play title" "play wave" "controls controls" "error error"',
    alignItems: 'center',
    columnGap: config.space.S300,
    width: '100%',
    minWidth: 0,
    padding: `${config.space.S300} ${config.space.S300} ${config.space.S100}`,
    borderRadius: toRem(20),
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
  gridArea: 'title',
  minWidth: 0,
  fontWeight: config.fontWeight.W500,
  paddingBlockEnd: config.space.S100,
});

export const PlayCell = style({
  gridArea: 'play',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const WaveformCell = style({
  gridArea: 'wave',
  minWidth: 0,
});

export const Controls = style({
  gridArea: 'controls',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  minWidth: 0,
  paddingBlockStart: config.space.S100,
});

export const Time = style({
  flex: '1 0 auto',
  marginInlineEnd: config.space.S200,
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  fontSize: toRem(12),
});

export const VolumeCell = style({ display: 'flex', alignItems: 'center' });
export const RateCell = style({ display: 'flex', alignItems: 'center' });
export const MoreCell = style({ display: 'flex', alignItems: 'center' });

export const Error = style({
  gridArea: 'error',
  color: color.Critical.Main,
  paddingBlockEnd: config.space.S200,
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
