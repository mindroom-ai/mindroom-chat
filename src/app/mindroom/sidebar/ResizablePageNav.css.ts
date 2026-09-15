import { globalStyle, style } from '@vanilla-extract/css';
import { color } from 'folds';

export const Panel = style({
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  maxWidth: '100%',
});

globalStyle(`${Panel} > :first-child`, { width: '100%', minWidth: 0 });
globalStyle(`${Panel}[data-collapse-preview='true'] > :first-child`, {
  visibility: 'hidden',
  overflow: 'hidden',
});

export const Handle = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetInlineEnd: -8,
  width: 16,
  zIndex: 1,
  cursor: 'col-resize',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 7,
      width: 2,
      backgroundColor: color.Background.ContainerLine,
    },
    '&:hover::after, &:focus-visible::after, &:active::after': {
      backgroundColor: color.Primary.Main,
    },
  },
  '@media': {
    '(pointer: coarse)': {
      width: 24,
      insetInlineEnd: -12,
      selectors: { '&::after': { left: 11 } },
    },
  },
});
