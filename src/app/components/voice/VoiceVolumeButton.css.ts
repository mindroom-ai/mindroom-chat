import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// Same 44 px hit area as the playback speed pill beside it.
export const Button = style([
  DefaultReset,
  {




    width: toRem(44),
    height: toRem(44),
    padding: 0,
    border: 'none',
    borderRadius: config.radii.Pill,
    background: 'none',
    color: 'inherit',
    cursor: 'pointer',
    selectors: {
      '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: `-${toRem(6)}`,
      },
    },
  },
]);

export const Menu = style({
  width: toRem(200),
  padding: `${config.space.S300} ${config.space.S400}`,
});

/** The slider's hit area; the visible line sits on its vertical center. */
export const Track = style([
  DefaultReset,
  {
    position: 'relative',
    display: 'flex',




  },
]);

export const TrackLine = style({
  width: '100%',
  height: toRem(6),
  borderRadius: config.radii.Pill,
});

export const Thumb = style({



  backgroundColor: color.Primary.Main,
  boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Primary.OnMain}`,
  outline: 'none',
  selectors: {
    '&:focus-visible': {
      boxShadow: `0 0 0 ${config.borderWidth.B600} ${color.Primary.ContainerLine}`,
    },
  },
});
