import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

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

const ROLE_LINES = 2;

/** An agent's role, cut to two lines. */
export const ProfileRole = style({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: ROLE_LINES,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
});

const noteShape = style({
  borderRadius: config.radii.R400,
  padding: `${config.space.S200} ${config.space.S300}`,
});

/**
 * Boxed notes in the card: `quiet` for why a member was removed or invited, `blocked` for the
 * note on a blocked person's card.
 */
export const ProfileNoteTone = styleVariants({
  quiet: [
    noteShape,
    { color: color.SurfaceVariant.OnContainer, background: color.SurfaceVariant.Container },
  ],
  blocked: [noteShape, { color: color.Critical.OnContainer, background: color.Critical.Container }],
});
