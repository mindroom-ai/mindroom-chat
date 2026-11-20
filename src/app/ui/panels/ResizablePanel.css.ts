import { globalStyle, style } from '@vanilla-extract/css';
import { color } from 'folds';

export const Panel = style({
  vars: { '--mr-panel-handle-inset': '8px' },
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
  maxWidth: '100%',
  '@media': {
    '(pointer: coarse)': { vars: { '--mr-panel-handle-inset': '12px' } },
  },
});

// The panel's first child sits between it and the content. The content keeps its own width (the
// panel's smallest, or the width it opens to or closes from) while the panel is narrower, so it
// slides in and out of view at the panel's moving edge, next to the splitter, instead of reflowing.
globalStyle(`${Panel} > :first-child`, {
  display: 'flex',
  width: '100%',
  minWidth: 0,
  minHeight: 0,
  overflowX: 'clip',
});
// The page navigation's moving edge is its end, so its content slides toward the rail.
globalStyle(`${Panel}[data-side='start'] > :first-child`, { justifyContent: 'flex-end' });
globalStyle(`${Panel} > :first-child > *`, {
  flex: '0 0 auto',
  width: 'var(--mr-panel-content-width, 100%)',
});

export const Handle = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetInlineEnd: 'calc(-1 * var(--mr-panel-handle-inset))',
  width: 'calc(2 * var(--mr-panel-handle-inset))',
  zIndex: 1,
  cursor: 'col-resize',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
  selectors: {
    [`${Panel}[data-side='end'] &`]: {
      insetInlineEnd: 'auto',
      insetInlineStart: 'calc(-1 * var(--mr-panel-handle-inset))',
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      insetInlineStart: 'calc(var(--mr-panel-handle-inset) - 1px)',
      width: 2,
      backgroundColor: color.Background.ContainerLine,
    },
    '&:hover::after, &:focus-visible::after, &:active::after': {
      backgroundColor: color.Primary.Main,
    },
  },
});

// Keep the scrollbar's hit area clear of the splitter; full-width panels have no handle.
globalStyle(`${Panel}[data-side='start']:has(> ${Handle})`, {
  vars: { '--mr-scrollbar-inset-end': 'var(--mr-panel-handle-inset)' },
});
