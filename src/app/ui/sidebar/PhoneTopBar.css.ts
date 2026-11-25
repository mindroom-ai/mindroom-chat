import { createVar, globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { touchTarget } from '../styles/touchTarget';
import { railWidth } from './SidebarItem.css';

/** The top row's height; the drawer starts below it and the call shortcut, if present. */
export const phoneTopBarHeight = toRem(52);
const callButtonHeight = `max(44px, ${toRem(44)})`;
const returnToCallRowHeight = `calc(${callButtonHeight} + ${config.space.S200})`;

export const PhoneChrome = style({ flexShrink: 0 });
export const phoneChromeHeight = createVar();

// Safe-area insets are physical; both rows use the same padding in either direction.
const safeAreaPadding = {
  paddingLeft: `max(${config.space.S200}, env(safe-area-inset-left, 0px))`,
  paddingRight: `max(${config.space.S200}, env(safe-area-inset-right, 0px))`,
};

export const ReturnToCallRow = style({
  ...safeAreaPadding,
  paddingBlockEnd: config.space.S200,
  backgroundColor: color.Background.Container,
});

// Give the stage and the page slide's copy their own offset, shared by their drawer layers.
const phoneLayout = ':is([data-phone-stage], [data-page-slide-copy])';
globalStyle(`${phoneLayout}:has(> .${PhoneChrome})`, {
  vars: { [phoneChromeHeight]: phoneTopBarHeight },
});
globalStyle(`${phoneLayout}:has(> .${PhoneChrome} > .${ReturnToCallRow})`, {
  vars: { [phoneChromeHeight]: `calc(${phoneTopBarHeight} + ${returnToCallRowHeight})` },
});

export const ReturnToCallButton = style({
  inlineSize: '100%',
  blockSize: callButtonHeight,
  minBlockSize: callButtonHeight,
  selectors: {
    '&[data-speaking]': { boxShadow: `inset 0 0 0 2px ${color.Success.Main}` },
  },
});

// A phone's top bar: menu, search and account in one row on the rail's colour. No line rules it off:
// the page below starts on its own surface colour, and the drawer, in the bar's colour, meets it.
export const PhoneTopBar = style([
  DefaultReset,
  {
    flexShrink: 0,
    blockSize: phoneTopBarHeight,
    display: 'flex',
    alignItems: 'center',
    columnGap: config.space.S200,
    ...safeAreaPadding,
    backgroundColor: color.Background.Container,
    color: color.Background.OnContainer,
  },
]);

/** The bar's buttons take a 44 px hit area on a touch screen, reaching half the gap between them. */
export const BarControl = style(touchTarget(config.space.S100));

/** The menu button's width: folds' `IconButton` of size 400. */
const menuButtonSize = toRem(40);

/**
 * Holds the menu button and its unread dot. The button sits on the centre line of the rail that
 * the drawer slides in below it, past the bar's own padding.
 */
export const MenuButtonFrame = style({
  position: 'relative',
  flexShrink: 0,
  marginInlineStart: `calc((${railWidth} - ${menuButtonSize}) / 2 - ${config.space.S200})`,
});

/** Marks unread messages somewhere: the accent colour, or the mention colour for a highlight. */
export const UnreadDot = style({
  position: 'absolute',
  insetBlockStart: toRem(4),
  insetInlineEnd: toRem(4),
  inlineSize: toRem(10),
  blockSize: toRem(10),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  // A ring in the bar's colour keeps the dot apart from the icon it overlaps.
  boxShadow: `0 0 0 ${toRem(2)} ${color.Background.Container}`,
  pointerEvents: 'none',
  selectors: {
    '&[data-highlight]': { backgroundColor: color.Critical.Main },
  },
});

/** The search field fills the room between the menu button and the bell. */
export const SearchField = style({ flexGrow: 1 });

/** Holds the Activity bell and its count. */
export const BellFrame = style({ position: 'relative', flexShrink: 0 });

/** The bell's count, over the bell's top end corner. */
export const BellBadge = style({
  position: 'absolute',
  insetBlockStart: toRem(-2),
  insetInlineEnd: toRem(-4),
  pointerEvents: 'none',
});
