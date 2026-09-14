import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

const collapsedMask = 'linear-gradient(to bottom, black calc(100% - 2.5em), transparent)';

export const CollapsibleContent = recipe({
  base: { position: 'relative' },
  variants: {
    collapsed: {
      true: { maskImage: collapsedMask, WebkitMaskImage: collapsedMask },
    },
  },
});

export const CollapsibleFooter = style({
  display: 'flex',
  justifyContent: 'flex-end',
  width: '100%',
  marginTop: config.space.S200,
  pointerEvents: 'none',
});

export const CollapsibleStickyFooter = style([
  CollapsibleFooter,
  { position: 'sticky', bottom: config.space.S200, zIndex: 1 },
]);

export const CollapsiblePill = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: toRem(32),
  maxWidth: '100%',
  padding: `${config.space.S100} ${config.space.S300}`,
  borderRadius: toRem(8),
  border: 'none',
  backgroundColor: color.SurfaceVariant.ContainerHover,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(13),
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.4,
  textAlign: 'center',
  pointerEvents: 'auto',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerActive },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '2px',
    },
  },
});
