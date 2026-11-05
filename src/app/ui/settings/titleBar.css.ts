import { style } from '@vanilla-extract/css';

// A settings page's title bar ends in a hairline, which the flat glass of a scroll header has no
// border for. The line takes the page's own line color, and plain units keep folds out of the
// page tests that mock it.
export const TitleBarLine = style({
  position: 'relative',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      insetInline: 0,
      insetBlockEnd: 0,
      blockSize: '1px',
      backgroundColor: 'var(--mr-container-line)',
      pointerEvents: 'none',
    },
  },
});
