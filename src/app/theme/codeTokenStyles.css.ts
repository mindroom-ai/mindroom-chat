import { globalStyle } from '@vanilla-extract/css';
import {
  CODE_TOKEN_TYPES,
  DARK_CODE_TOKEN_COLORS,
  ITALIC_CODE_TOKEN_ROLES,
  LIGHT_CODE_TOKEN_COLORS,
  type CodeTokenColors,
  type CodeTokenRole,
} from './codeTokenPalette';

// Syntax colors of PrismCode and JSON source token spans: the theme puts `prism-light` or
// `prism-dark` on <body> (useTheme.ts), and each picks its set from codeTokenPalette.ts.
const codeTokenSchemes: ReadonlyArray<[string, CodeTokenColors]> = [
  ['prism-light', LIGHT_CODE_TOKEN_COLORS],
  ['prism-dark', DARK_CODE_TOKEN_COLORS],
];

codeTokenSchemes.forEach(([schemeClass, tokenColors]) => {
  (Object.keys(CODE_TOKEN_TYPES) as CodeTokenRole[]).forEach((role) => {
    const selector = CODE_TOKEN_TYPES[role]
      .map((type) => `.${schemeClass} .token.${type}`)
      .join(', ');
    globalStyle(selector, {
      color: tokenColors[role],
      fontStyle: ITALIC_CODE_TOKEN_ROLES.includes(role) ? 'italic' : undefined,
    });
  });
});

globalStyle('.token.bold', { fontWeight: 700 });
globalStyle('.token.italic', { fontStyle: 'italic' });
globalStyle('.token.namespace', { opacity: 0.75 });
