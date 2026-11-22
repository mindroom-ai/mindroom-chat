import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

/** Keeps a long model name or raw value from pushing the tile's title off narrow viewports. */
export const TriggerButton = style({
  maxInlineSize: 'min(15rem, 55vw)',
});

/** Notice inside the menu when no runtime answered with a model list; reset still works above it. */
export const Unavailable = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  fontSize: config.fontSize.T200,
});

export const RetryButton = style({
  color: 'inherit',
  background: 'transparent',
  font: 'inherit',
  margin: 0,
  border: 0,
  cursor: 'pointer',
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  fontWeight: config.fontWeight.W500,
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}` },
  },
});
