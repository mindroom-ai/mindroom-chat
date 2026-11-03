import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// A pill that shows the playback speed ("1×", "1.5×") and cycles it on click; the hit area
// stays 44 px tall around the smaller visible pill.
export const Button = style([
  DefaultReset,
  {



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





  paddingInline: config.space.S100,



  selectors: {
    [`${Button}:hover &`]: {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
  },
});
