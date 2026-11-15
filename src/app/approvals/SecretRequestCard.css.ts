import { globalStyle, style, type GlobalStyleRule } from '@vanilla-extract/css';
import { SectionTitle } from './ThreadApprovals.css';

/** "GitHub key": a long service name ends in an ellipsis before it pushes the chip out. */
export const Title = style([
  SectionTitle,
  { flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
]);

/** The agent's reason, as it wrote it. */
export const Reason = style({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });

/**
 * The key field while the key is hidden. folds puts a field's class on its wrapper, so the rule
 * reaches the input inside. A password field would look like a sign-in to browsers and password
 * managers, which could fill in the account's password or offer to replace it with the key; a text
 * field masked by `-webkit-text-security`, which csstype does not list, looks like one without being one.
 */
export const Masked = style({});
globalStyle(`${Masked} input`, { WebkitTextSecurity: 'disc' } as unknown as GlobalStyleRule);

/**
 * The live region that says what an answer did. It stays mounted while the card is open, so a
 * screen reader announces the text it gets; empty, it takes no room.
 */
export const Status = style({
  selectors: {
    '&:empty': {
      position: 'absolute',
      inlineSize: 1,
      blockSize: 1,
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
    },
  },
});
