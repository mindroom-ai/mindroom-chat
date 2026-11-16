import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

/** A finished agent reply's work: the Worked for row and, when open, the work under it. */
export const Fold = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  marginBottom: config.space.S100,
});

/** A clock, the label and a chevron, in the tone of the reasoning toggle (Reasoning.css.ts). */
export const Toggle = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: '0.25rem',
  alignSelf: 'flex-start',
  padding: `${toRem(1)} 0`,
  color: 'inherit',
  background: 'none',
  border: 'none',
  font: 'inherit',
  opacity: 0.9,
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
    },
  },
});

export const Label = style({
  fontSize: toRem(12),
});

/** Points along the text while folded (right, or left in right-to-left), down while open. */
export const Chevron = style({
  flexShrink: 0,
  selectors: {
    '[dir=rtl] &': { transform: 'rotate(180deg)' },
    [`${Toggle}[aria-expanded="true"] &`]: { transform: 'rotate(90deg)' },
  },
  '@media': {
    '(prefers-reduced-motion: no-preference)': { transition: 'transform 150ms ease' },
  },
});

/** The work as the reply showed it before it finished. */
export const Work = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  marginTop: config.space.S100,
});
