import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// A quoted reply above a message: a thin bar, the sender, and one line of preview.
export const Reply = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S100,
    minWidth: 0,
    maxWidth: '100%',
    paddingInlineStart: config.space.S200,
    borderInlineStart: `${toRem(2)} solid ${color.SurfaceVariant.ContainerLine}`,
    marginBlockEnd: config.space.S100,
    cursor: 'pointer',
    selectors: {
      'button&': {
        background: 'none',
        border: 'none',
        borderInlineStart: `${toRem(2)} solid ${color.SurfaceVariant.ContainerLine}`,
        textAlign: 'start',













});
