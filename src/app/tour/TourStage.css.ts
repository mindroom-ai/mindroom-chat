import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { railWidth } from '../ui/sidebar/SidebarItem.css';
import { motion } from '../ui/styles/Motion.css';
import { transition } from '../ui/styles/transition';

const reducedMotion = '(prefers-reduced-motion: reduce)';
const hairline = `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`;

/** A keyframe animation that plays once and that reduced motion switches off. */
const once = (name: string, duration: string, easing: string, delay = '0ms') => ({
  animation: `${name} ${duration} ${easing} ${delay} both`,
  '@media': { [reducedMotion]: { animation: 'none' } },
});

/** The custom property that holds how much the room is scaled down to fit the frame. */
export const STAGE_SCALE = '--tour-stage-scale';
const scale = `var(${STAGE_SCALE}, 1)`;
/** How far the room reaches past each edge of the frame before it is scaled: nothing at 1. */
const outset = `calc((1 - 1 / ${scale}) * 50%)`;

/**
 * The stage's frame: the dialog sizes it, also its least height, and it clips the room and the
 * spotlight's shade.
 */
export const Frame = style({
  position: 'relative',
  overflow: 'hidden',
  isolation: 'isolate',
  borderRadius: config.radii.R500,
  border: hairline,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
});

/**
 * The sample room. It is laid out larger than the frame by the inverse of the scale and then
 * scaled down around its middle, so it fills the frame at a smaller size, in either direction of
 * writing.
 */
export const Room = style({
  position: 'absolute',
  insetBlock: outset,
  insetInline: outset,
  transform: `scale(${scale})`,
  userSelect: 'none',
  cursor: 'default',
});

const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

/** One view of the room: the list, an open thread or the messages, with what surrounds it. */
export const View = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  minWidth: 0,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
});

/** A view that comes in fades over the one it replaces. */
export const ViewEntering = style(once(fadeIn, motion.duration.Normal, motion.easing.Standard));

/** The page beside the rail: top bar, header, body and composer, top to bottom. */
export const Page = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
});

/** The room's header: its avatar and name, then its buttons. */
export const Header = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  columnGap: config.space.S300,
  minHeight: toRem(52),
  paddingInline: config.space.S400,
  borderBlockEnd: hairline,
});

/** A phone's header: the back chevron starts at the edge and the name follows it directly. */
export const PhoneHeader = style({
  columnGap: 0,
  paddingInline: config.space.S200,
});

export const HeaderName = style({ flexGrow: 1, minWidth: 0 });

export const HeaderButtons = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  columnGap: config.space.S100,
});

/** A back chevron as tall as the header's icons, as the phone's pages draw it. */
export const BackChevron = style({
  selectors: { '&&': { width: toRem(32), height: toRem(32) } },
});

/** What the header and the composer leave: the bar, then the cards, the thread or the messages. */
export const Body = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'hidden',
});

const arrive = keyframes({
  from: { opacity: 0, transform: `translateY(${toRem(6)})` },
  to: { opacity: 1, transform: 'none' },
});

/** What arrives in the room (a card, a message, the filter bar) fades in and settles. */
export const Arriving = style(once(arrive, motion.duration.Slow, motion.easing.Decelerate));

/**
 * The Compact view's cards, a little apart. Not positioned: a card's place counts from the body
 * around the list, so the filter bar above the list moves the cards too.
 */
export const CardList = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  rowGap: config.space.S100,
  minWidth: 0,
  padding: config.space.S300,
});

/** The heading of the Pinned section: a pin and the word. */
export const PinnedHeading = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: config.space.S100,
});

/** Holds a card with its buttons and its menu. */
export const CardShell = style({
  position: 'relative',
  flexShrink: 0,
  minWidth: 0,
});

/** The card whose menu is open stands over the cards after it. */
export const CardShellRaised = style({ zIndex: 3 });

/** The card the pointer is on: tinted as the app tints a hovered card. */
export const CardShellHovered = style({});
globalStyle(`${CardShellHovered} [data-thread-root-id]`, {
  backgroundColor: color.SurfaceVariant.ContainerHover,
});

/** A phone's card leaves room at the end of its last row for the Thread options button. */
export const PhoneCardShell = style({});
globalStyle(`${PhoneCardShell} [data-compact-card-metadata]`, {
  paddingInlineEnd: toRem(32),
});

/** The buttons a card shows while the pointer is on it, over the card's end. */
export const CardActions = style([
  once(fadeIn, motion.duration.Normal, motion.easing.Standard, '300ms'),
  {
    position: 'absolute',
    insetInlineEnd: config.space.S300,
    // Centered by its margins, not a transform: the spotlight measures layout offsets.
    insetBlock: 0,
    marginBlock: 'auto',
    height: 'fit-content',
    display: 'flex',
    alignItems: 'center',
    columnGap: config.space.S100,
    backgroundColor: color.SurfaceVariant.ContainerHover,
    selectors: {
      // The card's text fades out under the buttons.
      '&::before': {
        content: '""',
        position: 'absolute',
        insetBlock: 0,
        insetInlineStart: `calc(-1 * ${config.space.S500})`,
        width: config.space.S500,
        background: `linear-gradient(to right, transparent, ${color.SurfaceVariant.ContainerHover})`,
      },
      '[dir="rtl"] &::before': {
        background: `linear-gradient(to left, transparent, ${color.SurfaceVariant.ContainerHover})`,
      },
    },
  },
]);

/** A phone's Thread options button, centered on the card's last row. */
export const CardMenuButton = style({
  position: 'absolute',
  insetInlineEnd: config.space.S100,
  insetBlockEnd: `calc(${config.borderWidth.B300} + ${config.space.S200} + ${toRem(12)} - 1.25rem)`,
  selectors: { '&&': { width: '2.5rem', height: '2.5rem' } },
});

const SWIPE = toRem(108);
const swipe = keyframes({
  from: { transform: 'none' },
  to: { transform: `translateX(-${SWIPE})` },
});
const swipeRightToLeft = keyframes({
  from: { transform: 'none' },
  to: { transform: `translateX(${SWIPE})` },
});

/** A card and, under it, what a swipe shows. */
export const SwipeTrack = style({ position: 'relative' });

/** A card swiped toward the start of the line, once the step's scene starts. */
export const Swiped = style([
  once(swipe, motion.duration.Slower, motion.easing.Standard, '450ms'),
  {
    transform: `translateX(-${SWIPE})`,
    animationFillMode: 'backwards',
    selectors: {
      '[dir="rtl"] &': { transform: `translateX(${SWIPE})`, animationName: swipeRightToLeft },
    },
  },
]);

const drop = keyframes({
  from: { opacity: 0, transform: `translateY(-${toRem(4)})` },
  to: { opacity: 1, transform: 'none' },
});

/** A menu that opens fades in from just above its place. */
const opening = once(drop, motion.duration.Normal, motion.easing.Decelerate);

/** A card's Thread options menu, below its button. */
export const CardMenu = style([
  opening,
  {
    position: 'absolute',
    zIndex: 3,
    insetInlineEnd: config.space.S300,
    insetBlockStart: `calc(50% + ${toRem(20)})`,
    inlineSize: toRem(224),
  },
]);

/** On a phone the menu opens over the card's lower rows, so all of it stays in the stage. */
export const PhoneCardMenu = style({
  insetInlineEnd: config.space.S200,
  insetBlockStart: toRem(26),
});

/** A phone's room menu, under the button at the header's end. */
export const RoomMenu = style([
  opening,
  {
    position: 'absolute',
    zIndex: 4,
    insetInlineEnd: config.space.S200,
    insetBlockStart: toRem(46),
    inlineSize: toRem(224),
  },
]);

/** The composer, floating a little in from the room's edges. */
export const Composer = style({
  flexShrink: 0,
  marginInline: config.space.S300,
  marginBlockEnd: config.space.S300,
});

/** The composer's line of text: the placeholder, or what is typed so far. */
export const ComposerText = style({
  flex: '1 1 0',
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  fontSize: config.fontSize.T400,
  lineHeight: config.lineHeight.T400,
  letterSpacing: config.letterSpacing.T400,
  padding: `${toRem(13)} ${config.space.S100}`,
});

/** A third of the text color, as the app's placeholder. */
export const ComposerPlaceholder = style({ opacity: 0.333 });

const blink = keyframes({ '0%, 55%': { opacity: 1 }, '56%, 100%': { opacity: 0 } });

/** The text cursor after what is typed. */
export const Caret = style({
  display: 'inline-block',
  inlineSize: toRem(2),
  blockSize: '1.15em',
  marginInlineStart: toRem(1),
  verticalAlign: 'text-bottom',
  borderRadius: toRem(1),
  backgroundColor: color.Primary.Main,
  animation: `${blink} 1s linear infinite`,
  '@media': { [reducedMotion]: { animation: 'none' } },
});

/** An open thread: its banner over its messages. The spotlight rings all of it. */
export const Thread = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0',
  minHeight: 0,
  margin: config.space.S200,
  paddingBlockStart: config.space.S200,
});

/** Messages, top to bottom. */
export const Messages = style({
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S400,
  minHeight: 0,
  padding: `${config.space.S200} ${config.space.S400}`,
});

/** One message: the sender's avatar, then name, time and text. */
export const Message = style({
  display: 'flex',
  alignItems: 'flex-start',
  columnGap: config.space.S300,
  minWidth: 0,
});

export const MessageBody = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  rowGap: toRem(2),
  minWidth: 0,
});

export const MessageHead = style({
  display: 'flex',
  alignItems: 'baseline',
  columnGap: config.space.S200,
});

/** A message's text, with the mark of an agent that is still writing after it. */
export const MessageText = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: config.space.S200,
  minWidth: 0,
});

/** The reply count under a thread's first message. */
export const ReplyChip = style({ marginBlockStart: config.space.S100 });

/** The rail's edge toward the page. */
export const Rail = style({ borderInlineEnd: hairline });

/** A phone's top bar: menu, search, the bell and the account. */
export const PhoneBar = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  columnGap: config.space.S200,
  blockSize: toRem(52),
  paddingInline: config.space.S200,
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
});

/** The top bar's search field, which only stands for the real one. */
export const PhoneSearch = style({
  display: 'flex',
  alignItems: 'center',
  flexGrow: 1,
  blockSize: toRem(36),
  paddingInline: config.space.S300,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  opacity: config.opacity.P300,
});

/** Holds the bell and its count. */
export const BellFrame = style({ position: 'relative', flexShrink: 0 });

/** The bell's count, over the bell's top end corner. */
export const BellBadge = style({
  position: 'absolute',
  insetBlockStart: toRem(-2),
  insetInlineEnd: toRem(-4),
});

/** The bell's list beside the rail, over the spotlight's shade. */
export const ActivityPanel = style([
  opening,
  {
    position: 'absolute',
    zIndex: 11,
    insetBlockStart: config.space.S200,
    insetInlineStart: `calc(${railWidth} + ${config.space.S200})`,
    inlineSize: `min(${toRem(380)}, calc(100% - ${railWidth} - 2 * ${config.space.S200}))`,
  },
]);

const sheetUp = keyframes({ from: { transform: 'translateY(100%)' }, to: { transform: 'none' } });

/** On a phone the bell's list slides up as a sheet. */
export const ActivitySheet = style([
  once(sheetUp, motion.duration.Slower, motion.easing.Decelerate),
  {
    position: 'absolute',
    zIndex: 11,
    insetInline: 0,
    insetBlockEnd: 0,
    paddingBlockEnd: config.space.S200,
    borderStartStartRadius: config.radii.R500,
    borderStartEndRadius: config.radii.R500,
    borderBlockStart: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
    backgroundColor: color.Background.Container,
    color: color.Background.OnContainer,
    boxShadow: config.shadow.E400,
  },
]);

/** A phone's sheet starts with its title and a close button. */
export const SheetHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingInlineEnd: config.space.S200,
  paddingBlockStart: config.space.S100,
});

export const ActivityTitle = style({
  padding: `${config.space.S200} ${config.space.S300}`,
});

/** The layer the ring is placed in: left to right in every language, over all of the room. */
export const SpotlightLayer = style({
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  direction: 'ltr',
  pointerEvents: 'none',
});

/**
 * The spotlight: a ring in the accent color whose wide shadow, in the page's color, dims
 * everything outside it. It glides to its next part.
 */
export const Spotlight = style([
  once(fadeIn, motion.duration.Slow, motion.easing.Standard),
  {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    borderRadius: `calc(${config.radii.R400} + ${toRem(4)})`,
    boxShadow: [
      `0 0 0 ${toRem(2)} ${color.Primary.Main}`,
      `0 0 0 200vmax color-mix(in srgb, ${color.Surface.Container} 48%, transparent)`,
    ].join(', '),
    transition: transition(['transform', 'width', 'height'], motion.duration.Slower),
  },
]);
