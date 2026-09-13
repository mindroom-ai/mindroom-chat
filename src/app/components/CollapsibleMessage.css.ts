import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config } from 'folds';

export const CollapsibleContent = recipe({
  base: {
    position: 'relative',
  },
});

export const CollapsibleGradientOverlay = style({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: '1.5em',
  background: `linear-gradient(transparent, var(--collapsible-gradient-end, ${color.Surface.Container}))`,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: '2px',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const CollapsibleShowMore = style({
  fontSize: '0.7rem',
  fontFamily: 'monospace',
  opacity: 0.5,
  userSelect: 'none',
  letterSpacing: '0.1em',
});

export const CollapsibleCloseButton = style({
  position: 'absolute',
  top: config.space.S200,
  right: config.space.S200,
  zIndex: 1,
  border: 'none',
  background: color.Surface.ContainerActive,
  borderRadius: config.radii.Pill,
  width: '1.5rem',
  height: '1.5rem',
  minWidth: '24px',
  minHeight: '24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  lineHeight: 1,
  opacity: 0.8,
  padding: 0,
  color: color.Surface.OnContainer,
  boxShadow: `0 1px 3px rgba(0, 0, 0, 0.15)`,
  selectors: {
    '&:hover': {
      opacity: 1,
      background: color.Secondary.Container,
    },
    '&:focus-visible': {
      opacity: 1,
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});
