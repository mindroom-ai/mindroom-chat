import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { footerInset, topInset, Scroll } from '../../ui/styles/RoomOverlay.css';
import { transition } from '../../ui/styles/transition';

const touchActions = '(max-width: 480px), (hover: none)';

export const View = style([
  Scroll,
  {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: 0,
    padding: `${topInset} ${config.space.S300} calc(${footerInset} + ${config.space.S300})`,
    overflowY: 'auto',
    overflowX: 'hidden',
    width: '100%',
  },
]);

export const EmptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '8rem',
  padding: config.space.S400,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
});

export const CardShell = style({
  position: 'relative',
  width: '100%',
  minWidth: 0,
});

export const PinnedSection = style({
  paddingBlockEnd: config.space.S300,
});

export const Card = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    rowGap: config.space.S100,
    padding: `${config.space.S200} ${config.space.S300}`,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    inlineSize: '100%',
    borderRadius: config.radii.R400,
    backgroundColor: color.SurfaceVariant.Container,
    minInlineSize: 0,
    color: color.SurfaceVariant.OnContainer,
    textAlign: 'start',
    cursor: 'pointer',
    transition: transition(['background-color', 'border-color']),
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

// A card that holds controls of its own besides opening its thread (a call's row): the button
// that opens the thread fills the card's place for the summary.
export const CardButton = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    rowGap: config.space.S100,
    inlineSize: '100%',
    minInlineSize: 0,
    color: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    borderRadius: config.radii.R300,
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

// The keyboard's focus on the card or its buttons tints it; a menu that hands focus back to its
// button after a tap or a click does not.
globalStyle(`${CardShell}:has(:focus-visible) ${Card}`, {
  backgroundColor: color.SurfaceVariant.ContainerHover,
});

// A touch screen keeps :hover on the card tapped last; only a pointer that can hover tints it.
globalStyle(`${CardShell}:hover ${Card}, ${Card}:hover`, {
  '@media': {
    '(hover: hover)': { backgroundColor: color.SurfaceVariant.ContainerHover },
  },
});

export const CardAction = style({
  display: 'flex',
  gap: config.space.S100,
  backgroundColor: color.SurfaceVariant.ContainerHover,
  position: 'absolute',
  insetInlineEnd: config.space.S300,
  top: '50%',
  transform: 'translateY(-50%)',
  placeItems: 'center',
  opacity: 0,
  pointerEvents: 'none',
  transition: transition(['opacity']),
  '@media': {
    [touchActions]: {
      insetInlineEnd: config.space.S100,
      top: 'auto',
      // Centers the 2.5rem button on the card's last row (24px tall, above
      // an S200 padding and the border).
      bottom: `calc(${config.borderWidth.B300} + ${config.space.S200} + ${toRem(12)} - 1.25rem)`,
      transform: 'none',
      opacity: 1,
      pointerEvents: 'auto',
      background: 'none',
      selectors: {
        '&::before': {
          content: 'none',
        },
      },
    },
  },
  selectors: {
    '&::before': {
      content: "''",
      position: 'absolute',
      insetBlock: 0,
      insetInlineStart: `calc(-1 * ${config.space.S500})`,
      width: config.space.S500,
      pointerEvents: 'none',
      background: `linear-gradient(to right, transparent, ${color.SurfaceVariant.ContainerHover})`,
    },
  },
});

export const CardQuickAction = style({
  '@media': {
    [touchActions]: {
      display: 'none',
    },
  },
});

export const CardMenuButton = style({
  '@media': {
    [touchActions]: {
      width: '2.5rem',
      height: '2.5rem',
    },
    // A touch screen keeps :hover on the button tapped last, so after its menu closes the button
    // would stay tinted; there only the press itself and the keyboard's focus tint it.
    '(hover: none)': {
      selectors: {
        '&:hover:not(:focus-visible, :active)': { backgroundColor: 'transparent' },
      },
    },
  },
});

globalStyle(`[dir='rtl'] ${CardAction}::before`, {
  background: `linear-gradient(to left, transparent, ${color.SurfaceVariant.ContainerHover})`,
});

globalStyle(`${CardShell}:hover ${CardAction}, ${CardShell}:focus-within ${CardAction}`, {
  opacity: 1,
  pointerEvents: 'auto',
});

export const CardUnread = style({
  boxShadow: `inset ${toRem(3)} 0 0 ${color.Primary.Main}`,
});

globalStyle(`[dir='rtl'] ${CardUnread}`, {
  boxShadow: `inset -${toRem(3)} 0 0 ${color.Primary.Main}`,
});

export const CardResolved = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: config.space.S200,
  minWidth: 0,
});

export const TitleText = style({
  minWidth: 0,
  flex: 1,
  overflowWrap: 'anywhere',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: '2',
  overflow: 'hidden',
});

// A fixed slot for the short ages ("now", "1m", "59m", "23h"): a label that ticks to another
// width would wrap the title beside it again, and the card would change its height on screen.
export const TimeText = style({
  whiteSpace: 'nowrap',
  flexShrink: 0,
  minInlineSize: '4ch',
  textAlign: 'end',
  fontVariantNumeric: 'tabular-nums',
});

export const TimeTextUnread = style({
  // MainActive keeps 4.5:1 on the dark theme's cards, where Main has 4.0:1.
  color: color.Primary.MainActive,
  fontWeight: 600,
  opacity: 1,
});

export const MessagePreview = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
});

export const MessageText = style({
  minWidth: 0,
  flex: 1,
});

// Secondary text on a resolved card's green keeps 4.5:1 at the lighter of the two quiet levels.
globalStyle(
  `${CardResolved} ${MessageText}, ${CardResolved} ${TimeText}:not(${TimeTextUnread})`,
  { opacity: config.opacity.P400 }
);

// One line, so every card keeps one height: the byline and tags end in an ellipsis instead of
// wrapping.
export const MetadataRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
  minHeight: toRem(24),
});

globalStyle(`${MetadataRow} > .thread-tag-pill`, { minWidth: 0 });

// Room for the menu button that sits at the end of this row on touch; only
// the compact view's card shell has that button.
globalStyle(`${CardShell} ${MetadataRow}`, {
  '@media': {
    [touchActions]: {
      paddingInlineEnd: toRem(32),
    },
  },
});

export const Participants = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
});

export const ParticipantAvatar = style({
  flexShrink: 0,
});

export const ResolutionByline = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: config.space.S100,
  minWidth: 0,
  // Success.Main has 3.9:1 on the light theme's resolved card.
  color: color.Success.OnContainer,
  fontWeight: 500,
});

export const ResolutionBylineLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const StreamingStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: config.space.S100,
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

export const Stats = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: config.space.S200,
  flexShrink: 0,
  marginInlineStart: 'auto',
});

export const ScheduledIndicator = style({
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const ReplyCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(3),
  whiteSpace: 'nowrap',
});
