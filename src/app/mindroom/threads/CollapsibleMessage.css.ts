import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

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
  height: '2.5em',
  background: `linear-gradient(transparent, var(--collapsible-gradient-end, ${color.Surface.Container}))`,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: config.space.S100,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

const pillBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  padding: `${config.space.S100} ${config.space.S300}`,
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W500,
  lineHeight: 1,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  boxShadow: config.shadow.E100,
  whiteSpace: 'nowrap' as const,
};

export const CollapsibleShowMore = style({
  ...pillBase,
  userSelect: 'none',
  pointerEvents: 'none',
});

export const CollapsibleStickyFooter = style({
  position: 'sticky',
  bottom: config.space.S200,
  zIndex: 1,
  display: 'flex',
  justifyContent: 'center',
  width: '100%',
  marginTop: config.space.S200,
  pointerEvents: 'none',
});

export const CollapsiblePill = style({
  ...pillBase,
  pointerEvents: 'auto',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '2px',
    },
  },
});
