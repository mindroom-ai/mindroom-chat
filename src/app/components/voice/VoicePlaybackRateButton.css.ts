import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// A pill that shows the playback speed ("1×", "1.5×") and cycles it on click; the hit area
// stays 44 px tall around the smaller visible pill.
export const Button = style([
  DefaultReset,
  {
    display: 'inline-grid',
    placeItems: 'center',
    flexShrink: 0,
    minWidth: toRem(44),
    height: toRem(44),
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontVariantNumeric: 'tabular-nums',
    selectors: {
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: `-${toRem(6)}`,
        borderRadius: config.radii.Pill,
      },
    },
  },
]);

export const Label = style({
  boxSizing: 'border-box',
  minWidth: toRem(36),
  height: toRem(22),
  display: 'inline-grid',
  placeItems: 'center',
  paddingInline: config.space.S100,



  selectors: {
    [`${Button}:hover &`]: {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
  },
});
