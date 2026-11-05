import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Inline math (`<span data-mx-maths>`): flows with the text and never widens the message.
export const MathInline = style({
  display: 'inline-block',
  maxWidth: '100%',
  overflowX: 'auto',
  overflowY: 'hidden',
  verticalAlign: 'middle',
  // KaTeX measures its own glyph boxes; a little room keeps tall fractions from clipping.
  paddingBlock: '0.1em',
});

// Display math (`<div data-mx-maths>`, `$$...$$`): its own line, scrolled sideways when wide.
export const MathBlock = style({
  display: 'block',
  maxWidth: '100%',
  overflowX: 'auto',
  overflowY: 'hidden',
  margin: `${config.space.S200} 0`,
  textAlign: 'center',
});
