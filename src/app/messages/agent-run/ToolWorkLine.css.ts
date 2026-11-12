import { keyframes, style } from '@vanilla-extract/css';

// As long as TOOL_WORK_FADE_MS in ToolWorkLine.tsx, which unmounts the line after its fade out.
const FADE = '240ms';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(0.3em)' },
  to: { opacity: 1, transform: 'none' },
});
const fadeOut = keyframes({
  from: { opacity: 1, transform: 'none' },
  to: { opacity: 0, transform: 'translateY(-0.3em)' },
});

export const Line = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  animation: `${fadeIn} ${FADE} ease-out both`,
  selectors: {
    '&[data-leaving]': { animation: `${fadeOut} ${FADE} ease-in both` },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      selectors: { '&[data-leaving]': { animation: 'none' } },
    },
  },
});
