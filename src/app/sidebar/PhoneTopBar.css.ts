import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';
import { railWidth } from '../ui/sidebar/SidebarItem.css';

/** The bar's height; the drawer starts right below it. */
export const phoneTopBarHeight = toRem(52);

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
    paddingInline: config.space.S200,
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

/** The search field's outline, a hairline in the bar's line colour. */
const fieldOutline = `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`;

/** The search field: a button drawn as a text field, filling the room between the two buttons. */
export const SearchField = style([
  DefaultReset,
  {
    flexGrow: 1,
    minInlineSize: 0,
    blockSize: toRem(36),
    display: 'flex',
    alignItems: 'center',
    columnGap: config.space.S200,
    paddingInline: config.space.S300,
    // Drawn as a field: a shade off the bar, ruled and rounded, in the bar's text colour.
    background: color.Background.ContainerHover,
    borderBlock: fieldOutline,
    borderInline: fieldOutline,
    borderRadius: config.radii.R400,
    // A text field's pointer and alignment, though it is a button.
    color: 'inherit',
    cursor: 'text',
    textAlign: 'start',
    selectors: {
      '&:focus-visible': { outline: `${toRem(2)} solid ${color.Primary.Main}`, outlineOffset: 0 },
    },
  },
]);

/** The placeholder, which gives way first when the bar is narrow. */
export const SearchPlaceholder = style({ flexGrow: 1, minInlineSize: 0, opacity: 0.7 });

/** Holds the Activity bell and its count. */
export const BellFrame = style({ position: 'relative', flexShrink: 0 });

/** The bell's count, over the bell's top end corner. */
export const BellBadge = style({
  position: 'absolute',
  insetBlockStart: toRem(-2),
  insetInlineEnd: toRem(-4),
  pointerEvents: 'none',
});
