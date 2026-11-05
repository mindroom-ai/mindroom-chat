import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

/** The small glass chip that holds the slider, below the More menu's volume row. */
export const Menu = style({
  width: toRem(164),
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  borderRadius: config.radii.R500,
});

/**
 * The slider's hit area; the visible line sits on its vertical center. Like the waveform, it
 * runs left to right in every language: react-range moves the thumb from the left edge.
 */
export const Track = style([
  DefaultReset,
  {
    direction: 'ltr',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    inlineSize: '100%',
    height: toRem(32),
    cursor: 'pointer',
  },
]);

// One quiet line without a fill: the thumb alone marks the volume.
export const TrackLine = style({
  width: '100%',
  height: toRem(6),
  borderRadius: config.radii.Pill,
  backgroundColor: `color-mix(in srgb, ${color.Surface.OnContainer} 14%, transparent)`,
});

export const Thumb = style({
  width: toRem(16),
  height: toRem(16),
  borderRadius: config.radii.Round,
  background: color.Primary.Main,
  boxShadow: '0 1px 3px rgb(0 0 0 / 30%)',
  outline: 'none',
  selectors: {
    '&:focus-visible': {
      boxShadow: `0 0 0 ${config.borderWidth.B600} ${color.Primary.ContainerLine}`,
    },
  },
});
