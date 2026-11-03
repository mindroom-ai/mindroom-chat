import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Marker = style({
  display: 'flex',
});

export const MarkerTrigger = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  minWidth: 0,
  border: 0,
  borderRadius: config.radii.R300,
  padding: `${toRem(1)} ${config.space.S100}`,
  marginInlineStart: `calc(-1 * ${config.space.S100})`,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'start',
  transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
  // folds' muted text level, which keeps 12px text above WCAG AA contrast.
  opacity: config.opacity.P300,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
      color: color.Primary.Main,
      background: color.Primary.Container,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

export const MarkerDetails = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxWidth: toRem(280),
});
