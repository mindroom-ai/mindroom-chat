import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

/** The card: a fixed width, so long names wrap instead of stretching it. */
export const ProfileCard = style({
  inlineSize: toRem(300),
  maxInlineSize: 'calc(100vw - 2rem)',
  padding: config.space.S400,
});

export const ProfileAvatar = style({
  inlineSize: toRem(56),
  blockSize: toRem(56),
  flexShrink: 0,
  borderRadius: '50%',
  overflow: 'hidden',
});

/** Names and IDs can be long words; they wrap anywhere rather than overflow the card. */
export const ProfileName = style({
  overflowWrap: 'anywhere',
});

export const ProfileUserId = style({
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
