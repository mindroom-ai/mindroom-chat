import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** Off screen until Tab reaches it, then a pill in the top corner above everything. */
export const SkipLink = style({
  position: 'fixed',
  insetBlockStart: config.space.S200,
  insetInlineStart: config.space.S200,
  zIndex: 9999,
  padding: `${config.space.S200} ${config.space.S400}`,
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  color: color.Primary.OnMain,
  fontSize: toRem(14),
  fontWeight: config.fontWeight.W500,
  textDecoration: 'none',
  boxShadow: `0 ${toRem(2)} ${toRem(8)} rgba(0, 0, 0, 0.2)`,
  transform: `translateY(calc(-100% - ${toRem(24)}))`,
  selectors: {
    '&:focus': {
      transform: 'none',
      outline: `${toRem(2)} solid ${color.Primary.OnMain}`,
      outlineOffset: toRem(-4),
    },
  },
});
