import { globalStyle } from '@vanilla-extract/css';
import {
  CODE_TOKEN_TYPES,
  DARK_CODE_TOKEN_COLORS,
  ITALIC_CODE_TOKEN_ROLES,
  LIGHT_CODE_TOKEN_COLORS,
  type CodeTokenColors,
  type CodeTokenRole,
} from './codeTokenPalette';

// The theme puts `prism-light` or `prism-dark` on <body> (useTheme.ts); each picks its colors
// for the token spans of PrismCode.
const schemes: ReadonlyArray<[string, CodeTokenColors]> = [
  ['prism-light', LIGHT_CODE_TOKEN_COLORS],
  ['prism-dark', DARK_CODE_TOKEN_COLORS],
];

const roles = Object.keys(CODE_TOKEN_TYPES) as CodeTokenRole[];

schemes.forEach(([schemeClass, colors]) => {
  roles.forEach((role) => {
    const selector = CODE_TOKEN_TYPES[role]
      .map((type) => `.${schemeClass} .token.${type}`)
      .join(', ');
    globalStyle(selector, {
      color: colors[role],
      fontStyle: ITALIC_CODE_TOKEN_ROLES.includes(role) ? 'italic' : undefined,
    });
  });
});

globalStyle('.token.bold', { fontWeight: 700 });
globalStyle('.token.italic', { fontStyle: 'italic' });
globalStyle('.token.namespace', { opacity: 0.75 });
