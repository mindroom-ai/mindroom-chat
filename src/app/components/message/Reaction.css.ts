import { createVar, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// The pill's three colors are variables, so the pressed and hover states only swap their values.
const fill = createVar();
const edge = createVar();
const ink = createVar();

// A pill with the emoji (or custom emoji image) and the count; tinted while the user's own
// reaction is among them.
export const Reaction = style([
  DefaultReset,
  {
    vars: {
      [fill]: color.SurfaceVariant.Container,
      [edge]: color.SurfaceVariant.ContainerLine,
      [ink]: color.SurfaceVariant.OnContainer,
    },
    display: 'inline-flex',
    minBlockSize: toRem(28),
    gap: config.space.S100,
    alignItems: 'center',
    paddingInline: config.space.S200,
    border: `${config.borderWidth.B300} solid ${edge}`,
    borderRadius: config.radii.Pill,
    background: fill,
    color: ink,
    font: 'inherit',
    cursor: 'pointer',
    selectors: {
      '&[aria-pressed=true]': {
        vars: {
          [fill]: color.Primary.Container,
          [edge]: color.Primary.ContainerLine,
          [ink]: color.Primary.OnContainer,
        },
      },
      '&:hover, &:focus-visible': { vars: { [fill]: color.SurfaceVariant.ContainerHover } },
      '&:disabled': { cursor: 'default' },
    },
  },
]);

export const ReactionImg = style({
  height: toRem(18),
  width: 'auto',
  objectFit: 'contain',
});

export const ReactionText = style({
  lineHeight: 1,
  maxWidth: toRem(160),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
