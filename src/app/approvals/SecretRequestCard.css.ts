import { globalStyle, style, type GlobalStyleRule } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { SectionHeader, SectionTitle } from './ThreadApprovals.css';

/** "GitHub key": a long service name ends in an ellipsis before it pushes the chip out. */
export const Title = style([
  SectionTitle,
  { flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
]);

/** A card that is done: folded to its header, which opens it as a tool approval's receipt opens. */
export const Fold = style({ minWidth: 0 });

/** The folded card's header, the same row as the open card's, with the arrow after its status. */
export const FoldRow = style([
  SectionHeader,
  {
    cursor: 'pointer',
    listStyle: 'none',
    borderRadius: config.radii.R300,
    selectors: {
      '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 2 },
    },
  },
]);
globalStyle(`${FoldRow}::-webkit-details-marker`, { display: 'none' });

/** The open fold's details, as far below the header as on the open card. */
export const FoldBody = style({ marginBlockStart: config.space.S200 });

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
 * The button to the page that gives the secret: as wide as its text, never wider than the card,
 * and a button to the eye, so without a link's underline. A host too long for one line wraps and
 * the button grows with it: the end of a host says whose page it is, so it is never cut off.
 */
export const Link = style({
  selectors: {
    // Twice, to stand above the height a button has for its size.
    '&&': {
      alignSelf: 'flex-start',
      maxInlineSize: '100%',
      blockSize: 'auto',
      minBlockSize: toRem(32),
      paddingBlock: config.space.S100,
      textDecoration: 'none',
    },
  },
});

/** The button's text, which breaks inside a host that has no place to break. */
export const LinkText = style({ minInlineSize: 0, overflowWrap: 'anywhere' });

/** The requester's choice, field and buttons, which lie in the card as if no element held them. */
export const Answer = style({ display: 'contents' });

/** The choice of how long a temporary secret is kept: its options, one to a line. */
export const Keep = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  margin: 0,
  padding: 0,
  border: 'none',
  minInlineSize: 0,
});

/** One option: its radio button and its text, which wraps beside the button. */
export const KeepOption = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: config.space.S200,
  cursor: 'pointer',
});

/**
 * The live region that says what an answer did. It stays mounted while the card is open and
 * through the fold the answer brings, so a screen reader announces the text it gets; empty, it
 * takes no room.
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

/**
 * Save and Decline while the answer is on its way: `aria-disabled`, not `disabled`, so the button
 * keeps the keyboard focus, and looks as a disabled one does.
 */
export const Busy = style({
  selectors: {
    '&[aria-disabled="true"]': { cursor: 'progress', opacity: config.opacity.Disabled },
  },
});
