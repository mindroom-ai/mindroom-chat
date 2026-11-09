import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;
/** A flex column, and a flex row centred across, the two layouts the list is built of. */
const stack = { display: 'flex', flexFlow: 'column nowrap' } as const;
const strip = { display: 'flex', flexFlow: 'row nowrap', alignItems: 'center' } as const;
const roundDot = (size: number) => ({
  inlineSize: toRem(size),
  blockSize: toRem(size),
  borderRadius: '50%',
});
const hairline = `${borderWidth.B300} solid ${color.Background.ContainerLine}`;

export const List = style({ ...stack, minInlineSize: 0 });

export const Header = style({
  ...strip,
  columnGap: space.S200,
  padding: `${space.S200} ${space.S300}`,
});

/** The Unread label beside its switch; a press on either toggles it. */
export const Toggle = style({ ...strip, columnGap: space.S100, cursor: 'pointer' });

export const Tabs = style({
  ...strip,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  columnGap: space.S100,
  padding: `${space.S100} ${space.S300}`,
  borderBlockEnd: hairline,
});

export const Divider = style({
  paddingBlock: `${space.S300} ${space.S100}`,
  paddingInline: space.S300,
  color: color.Background.OnContainer,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
});

export const Row = style({
  position: 'relative',
  display: 'flex',
  columnGap: space.S300,
  padding: `${space.S200} ${space.S300}`,
  borderRadius: radii.R400,
  selectors: { '&:hover': { backgroundColor: color.Background.ContainerHover } },
});

/** The row's text, one button that opens its thread. */
export const OpenButton = style({
  ...stack,
  rowGap: toRem(2),
  inlineSize: '100%',
  minInlineSize: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  borderRadius: radii.R300,
  ':focus-visible': {
    outline: `${borderWidth.B400} solid ${color.Primary.Main}`,
    outlineOffset: borderWidth.B400,
  },
});

export const Muted = style({ fontWeight: 400 });

/** Two lines at most of a reply's text, wrapping anywhere so a long word cannot widen the row. */
export const Preview = style({
  overflow: 'hidden',
  display: '-webkit-box',
  overflowWrap: 'anywhere',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
});

export const ErrorText = style({ color: color.Critical.Main });

export const RowNeedsYou = style({
  backgroundColor: color.Warning.Container,
  selectors: { '&:hover': { backgroundColor: color.Warning.ContainerHover } },
});

/** A read row: its sentence in regular weight, the rest as on an unread one. */
export const RowRead = style({});

export const AvatarSlot = style({ position: 'relative', flexShrink: 0, alignSelf: 'flex-start' });

/** The kind of a row, a small round mark on the avatar's bottom end corner. */
export const KindBadge = style({
  ...roundDot(16),
  position: 'absolute',
  insetInlineEnd: toRem(-4),
  insetBlockEnd: toRem(-3),
  display: 'grid',
  placeItems: 'center',
  border: `${borderWidth.B400} solid ${color.Background.Container}`,
  color: color.Primary.OnMain,
  backgroundColor: color.Secondary.Main,
});

export const KindAttention = style({
  backgroundColor: color.Warning.Main,
  color: color.Warning.OnMain,
});
export const KindMention = style({ backgroundColor: color.Primary.Main });
export const KindDone = style({ backgroundColor: color.Success.Main, color: color.Success.OnMain });
export const KindStopped = style({
  backgroundColor: color.Critical.Main,
  color: color.Critical.OnMain,
});

export const Body = style({ ...stack, flexGrow: 1, minInlineSize: 0, rowGap: toRem(2) });

export const Line = style({
  display: 'flex',
  alignItems: 'baseline',
  columnGap: space.S100,
  minInlineSize: 0,
});

export const Grow = style({ flexGrow: 1, minInlineSize: 0 });

/** The row's sentence wraps, also inside a user ID, which must show whole after a copied name. */
export const Sentence = style({ flexGrow: 1, minInlineSize: 0, overflowWrap: 'anywhere' });

export const UnreadDot = style({
  ...roundDot(8),
  flexShrink: 0,
  alignSelf: 'center',
  backgroundColor: color.Primary.Main,
});

export const Context = style({
  display: 'flex',
  columnGap: space.S100,
  minInlineSize: 0,
  color: color.Background.OnContainer,
});

export const Actions = style({
  ...strip,
  flexWrap: 'wrap',
  gap: space.S100,
  paddingBlockStart: space.S100,
});

export const Footer = style({
  ...strip,
  columnGap: space.S200,
  padding: `${space.S200} ${space.S300}`,
  borderBlockStart: `${borderWidth.B300} dashed ${color.Background.ContainerLine}`,
});

export const Empty = style({
  ...stack,
  alignItems: 'center',
  textAlign: 'center',
  rowGap: space.S200,
  padding: `${space.S700} ${space.S500}`,
});
