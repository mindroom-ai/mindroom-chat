import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// A phone's width (`useScreenSize`), where thread titles wrap and their room goes under them.
const PHONE = 'screen and (max-width: 750px)';

/** The page's scrolling area: the column in the middle, the footer at the bottom. */
export const Scroll = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  padding: config.space.S400,
});

/** One column for greeting, ask field, threads and notices, so they share their edges. */
export const Column = style({
  width: '100%',
  maxWidth: toRem(680),
  marginInline: 'auto',
  marginBlock: 'auto',
  paddingBlock: config.space.S700,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S500,
});

/** The pictures of pickers and thread rows, 1.25rem across. */
export const PickerAvatar = style({ width: toRem(20), height: toRem(20), flexShrink: 0 });
globalStyle(`${PickerAvatar} *`, { fontSize: toRem(10) });

/** A picker's choice, cut short when the row has no room for it. */
export const PickerText = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(4),
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

// Without a chat to send to yet, the field is a button shaped as the composer is.
export const StandIn = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  padding: config.space.S200,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R500,
  backgroundColor: color.SurfaceVariant.Container,
});

export const StandInField = style({
  all: 'unset',
  cursor: 'text',
  minHeight: toRem(44),
  paddingInline: config.space.S200,
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.Placeholder,
  selectors: {
    '&:focus-visible': { outline: `${config.borderWidth.B600} solid ${color.Primary.Main}` },
  },
});

export const StandInError = style({ color: color.Critical.Main, paddingInline: config.space.S200 });

export const StandInRow = style({ display: 'flex', alignItems: 'center', gap: toRem(4) });

export const Recent = style({ display: 'flex', flexDirection: 'column' });

export const RecentHeader = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  paddingInline: config.space.S100,
  paddingBlockEnd: config.space.S200,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const LinkButton = style({
  all: 'unset',
  cursor: 'pointer',
  color: color.Primary.Main,
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover': { textDecoration: 'underline' },
    '&:focus-visible': { outline: `${config.borderWidth.B600} solid ${color.Primary.Main}` },
  },
});

export const ThreadList = style({ listStyle: 'none', margin: 0, padding: 0 });

// The notices under the list (`account/onboarding/WelcomeNotice.css.ts`) line up with these
// columns: avatar 1.25rem, dot slot 0.375rem, gaps 0.625rem.
export const ThreadRow = style({
  all: 'unset',
  boxSizing: 'border-box',
  cursor: 'pointer',
  width: '100%',
  display: 'grid',
  gridTemplateColumns: `${toRem(20)} ${toRem(6)} minmax(0, 1fr) auto`,
  columnGap: toRem(10),
  alignItems: 'center',
  minHeight: toRem(44),
  paddingBlock: config.space.S200,
  paddingInline: config.space.S100,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.Container },
    '&:focus-visible': { outline: `${config.borderWidth.B600} solid ${color.Primary.Main}` },
  },
  '@media': { [PHONE]: { alignItems: 'start' } },
});

export const ThreadDotSlot = style({ display: 'flex', justifyContent: 'center' });

export const ThreadDot = style({
  width: toRem(6),
  height: toRem(6),
  borderRadius: '50%',
  backgroundColor: color.Primary.Main,
});

/** Title then room on one line; on a phone the title wraps to two lines and the room goes under. */
export const ThreadText = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: config.space.S300,
  minWidth: 0,
  '@media': { [PHONE]: { flexDirection: 'column', gap: 0 } },
});

export const ThreadTitle = style({
  flexGrow: 1,
  minWidth: 0,
  fontWeight: config.fontWeight.W500,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  selectors: { '&[data-unread]': { fontWeight: config.fontWeight.W600 } },
  '@media': {
    [PHONE]: {
      whiteSpace: 'normal',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
    },
  },
});

export const ThreadRoom = style({ flexShrink: 0, whiteSpace: 'nowrap' });

export const ThreadTime = style({
  minWidth: toRem(56),
  textAlign: 'end',
  whiteSpace: 'nowrap',
});

export const Footer = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlockStart: config.space.S400,
});
