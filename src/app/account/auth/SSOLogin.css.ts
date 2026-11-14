import { style } from '@vanilla-extract/css';
import { DARK_THEMES } from '../../preferences/themeNames';

// No folds tokens here: the SSO button tests replace folds with plain elements, and these
// classes load in them as they are.

/** A provider's mark in front of its button label, sized to the label's line. */
export const ProviderMark = style({
  display: 'block',
  flexShrink: 0,
  inlineSize: '1.125rem',
  blockSize: '1.125rem',
  objectFit: 'contain',
});

/** GitHub ships its mark in near-black; on a dark theme it is drawn light so it stays visible. */
export const GitHubMark = style({
  selectors: {
    [`${DARK_THEMES} &`]: { filter: 'invert(1)' },
  },
});

/**
 * Sign in with Apple keeps Apple's black button with a white mark and label in every theme.
 * The doubled class outranks the folds fill and its hover and pressed shades.
 */
export const AppleButton = style({
  selectors: {
    '&&': { backgroundColor: '#000000', borderColor: '#000000', color: '#FFFFFF' },
    '&&:hover, &&:focus-visible': { backgroundColor: '#1D1D1F' },
    '&&:active, &&[aria-pressed=true]': { backgroundColor: '#333336' },
  },
});
