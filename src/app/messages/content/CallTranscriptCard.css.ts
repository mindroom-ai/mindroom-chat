import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../ui/styles/Glass.css';

const AVATAR = toRem(24);
const quiet = color.SurfaceVariant;

/** A card as wide as its content, up to a readable width, inside any message layout. */
export const CallCard = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    color: quiet.OnContainer,
    maxWidth: `min(100%, ${toRem(560)})`,
    display: 'flex',
    gap: config.space.S100,
    flexDirection: 'column',
    width: 'fit-content',
    paddingInline: config.space.S300,
    alignSelf: 'flex-start',
    paddingBlock: config.space.S200,
    minWidth: 0,
    borderRadius: config.radii.R400,
  },
]);

/**
 * The card's one row: the call at its start, the transcript's button at its end. A row too narrow
 * for both (a very large text size) puts the button under the call rather than overflow the card.
 */
export const Row = style({
  alignItems: 'center',
  display: 'flex',
  minWidth: 0,
  flexWrap: 'wrap',
  // With the button's start padding, 14 px between the duration and the count: the row fits a
  // 390 px phone in German.
  columnGap: config.space.S200,
});

/** The phone icon, "Voice call" and the duration. */
export const Header = style({
  minWidth: 0,
  display: 'flex',
  columnGap: config.space.S200,
  alignItems: 'center',
});

/**
 * An icon's place: as wide as a speaker's avatar, so the phone sits over the avatars and the
 * title starts where the speakers' names do, and the chevron gets the same room at the end.
 */
export const IconSlot = style({
  display: 'inline-flex',
  justifyContent: 'center',
  inlineSize: AVATAR,
  flexShrink: 0,
  alignItems: 'center',
  blockSize: AVATAR,
});

/** The row's words stay on one line each. */
export const Label = style({ whiteSpace: 'nowrap' });

export const Title = style({ fontWeight: 500 });

/** A call's notes, as the message's body renders them, between the row and the transcript. */
export const Notes = style({ minWidth: 0 });

/** The transcript's open and close button: the turn count and a chevron, at the row's end. */
export const Toggle = style({
  marginInlineStart: 'auto',
  font: 'inherit',
  alignItems: 'center',
  border: 0,
  color: 'inherit',
  display: 'inline-flex',
  background: 'none',
  cursor: 'pointer',
  textAlign: 'start',
  // The chevron's slot ends the row; its empty half pads the button's end.
  paddingInlineEnd: 0,
  paddingInlineStart: toRem(6),
  borderRadius: config.radii.R300,
  paddingBlock: 0,
  selectors: {
    '&:hover': { background: quiet.ContainerHover },
    '&:active': { background: quiet.ContainerActive },
    '&:focus-visible': {
      outlineOffset: toRem(1),
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
    },
  },
});

export const Turns = style({
  listStyle: 'none',
  display: 'flex',
  margin: 0,
  flexDirection: 'column',
  paddingInlineStart: 0,
  gap: config.space.S200,
  paddingBlockStart: config.space.S200,
  minWidth: 0,
  borderBlockStart: `${config.borderWidth.B300} solid ${quiet.ContainerLine}`,
});

/** One speaker's run of turns: the avatar, then the name over the turns' text. */
export const Group = style({
  gridTemplateColumns: `${AVATAR} minmax(0, 1fr)`,
  display: 'grid',
  columnGap: config.space.S200,
  alignItems: 'start',
  minWidth: 0,
});

export const Avatar = style({ inlineSize: AVATAR, blockSize: AVATAR, borderRadius: '50%' });

// Each line is as wide as its words and starts beside the avatar, as message bodies do, also when
// it reads the other way from the interface.
export const GroupBody = style({
  alignItems: 'flex-start',
  flexDirection: 'column',
  minWidth: 0,
  display: 'flex',
  gap: toRem(2),
});

/** The name, then the time: a long name ends in an ellipsis and leaves the time in view. */
export const NameLine = style({
  columnGap: config.space.S200,
  display: 'flex',
  maxWidth: '100%',
  alignItems: 'baseline',
  minWidth: 0,
});

// As wide as its words but never wider than the group: a long name ends in an ellipsis instead of
// running out of the card.
export const Name = style({ fontWeight: 600, minWidth: 0, maxWidth: '100%' });

/** When the speaker began, from the call's start: quiet, with digits of one width. */
export const Time = style({
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
});

/** Spoken text keeps its line breaks and wraps anywhere rather than overflow the card. */
export const Text = style({
  maxWidth: '100%',
  whiteSpace: 'pre-wrap',
  margin: 0,
  overflowWrap: 'anywhere',
});

/** Show more or less of a long turn: a quiet link-like button under its text. */
export const More = style({
  padding: 0,
  font: 'inherit',
  fontSize: toRem(12),
  border: 0,
  color: color.Primary.Main,
  background: 'none',
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover': { textDecoration: 'underline' },
    '&:focus-visible': {
      outlineOffset: toRem(1),
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
    },
  },
});
