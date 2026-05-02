import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Capsule = style([
  DefaultReset,
  {
    display: 'grid',
    gridTemplateColumns: `${toRem(36)} minmax(${toRem(112)}, 1fr) auto auto`,
    alignItems: 'center',
    gap: config.space.S200,
    width: `min(100%, ${toRem(320)})`,
    maxWidth: '100%',
    minHeight: toRem(44),
    padding: `${config.space.S100} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
  },
]);

export const Time = style({
  minWidth: toRem(36),
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  whiteSpace: 'nowrap',
});

export const Audio = style({
  display: 'none',
});
