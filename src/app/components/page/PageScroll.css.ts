import { style } from '@vanilla-extract/css';
import { toRem } from 'folds';

export const PageScroll = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
  maxHeight: '100%',
});

export const PageScrollBody = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
});

export const PageScrollViewport = style({
  flexGrow: 1,
  minHeight: 0,
});

export const PageScrollbar = style({
  top: toRem(4),
  bottom: toRem(4),
  zIndex: 1,
});
