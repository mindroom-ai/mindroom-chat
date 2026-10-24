import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// Holds text styled like the timestamp beside it, so the header keeps its height.
export const CostButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    border: 0,
    borderRadius: config.radii.R300,
    padding: `0 ${toRem(3)}`,
    color: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    selectors: {
      '&:hover': {
        backgroundColor: color.SurfaceVariant.Container,
      },
      '&:focus-visible': {
        outline: `${toRem(2)} solid currentColor`,
        outlineOffset: toRem(1),
      },
    },
  },
]);
