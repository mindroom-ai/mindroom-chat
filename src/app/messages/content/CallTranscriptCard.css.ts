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

export const Header = style({
  rowGap: toRem(2),
  display: 'flex',
  columnGap: config.space.S200,
  flexWrap: 'wrap',
  minWidth: 0,
  alignItems: 'center',
});

export const Title = style({ fontWeight: 500 });

/** The transcript's open and close button: a quiet line under the header. */
export const Toggle = style({
  gap: config.space.S100,
  font: 'inherit',
  border: 0,
  display: 'inline-flex',
  alignSelf: 'flex-start',
  color: 'inherit',
  background: 'none',
  alignItems: 'center',
  textAlign: 'start',
  maxWidth: '100%',
  cursor: 'pointer',
  // The chevron lines up with the phone icon above it.
  marginInlineStart: toRem(-4),
  paddingInline: toRem(4),
  borderRadius: config.radii.R300,
  paddingBlock: toRem(2),
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

export const GroupBody = style({
  flexDirection: 'column',
  minWidth: 0,
  display: 'flex',
  gap: toRem(2),
});

export const Name = style({ fontWeight: 600 });

/** Spoken text keeps its line breaks and wraps anywhere rather than overflow the card. */
export const Text = style({ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
