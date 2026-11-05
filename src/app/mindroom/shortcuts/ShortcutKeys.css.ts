import { style } from '@vanilla-extract/css';

// No theme tokens: menus across the app show this, and their tests stub the design system.
// The keys are generated content, so they stay out of the row's text and accessible name.
export const KeysHint = style({
  direction: 'ltr',
  unicodeBidi: 'isolate',
  whiteSpace: 'nowrap',
  font: 'inherit',
  fontSize: '0.75rem',
  opacity: 0.65,
  '::after': { content: 'attr(data-keys)' },
});
