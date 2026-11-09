import { createVar, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../styles/Motion.css';
import { shortViewport } from '../styles/shortViewport';

// Measured from docs/design/reference/home.png (1440x900 at 1x): the rail is 66 px wide and
// holds 42 px avatars (folds Avatar size 400 is 2.625rem) at 12 px from the edge (S300), 12 px
// apart (S300), starting 12 px from the top (S300), with 12 px corners (folds R500). Task 8's
// ui/sidebar/Sidebar.css.ts keeps only the drag source styles; the rail and stack are defined here
// once.

/** A flex column, which the rail and its stacks both are. */
const FlexColumn = style({ display: 'flex', flexFlow: 'column' });

/** Centres whatever it holds on both axes. */
const Centered = style({ display: 'flex', alignItems: 'center', justifyContent: 'center' });

/** The rail: a fixed-width column, as tall as the client. */
export const Sidebar = style([
  DefaultReset,
  FlexColumn,
  {
    flex: 'none',
    color: color.Background.OnContainer,
    backgroundColor: color.Background.Container,
    inlineSize: toRem(66),
    blockSize: '100%',
    '@media': {
      // A phone in landscape scrolls the whole rail (SidebarScrollPart). No scrollbar, as the
      // rail's own scrollers show none: it would take the rail's width.
      [shortViewport]: { overflowX: 'hidden', overflowY: 'auto', scrollbarWidth: 'none' },
    },
    selectors: { '&::-webkit-scrollbar': { display: 'none' } },
  },
]);

/** A group of rail items, centred, `S300` apart and inset from the group's edges. */
export const SidebarStack = style([
  DefaultReset,
  FlexColumn,
  {
    inlineSize: '100%',
    paddingBlock: config.space.S300,
    alignItems: 'center',
    gap: config.space.S300,
  },
]);

/** A short rule between two stacks. */
export const SidebarStackSeparator = style({
  width: toRem(24),
  height: config.borderWidth.B300,
  backgroundColor: color.Background.ContainerLine,
  marginInline: 'auto',
  flex: 'none',
});

/** Marks the rail entry, so its button can react to the entry being hovered or pressed. */
const sidebarItemRoot = style({});

/**
 * How far a hovered or keyboard-focused rail button slides toward the inline end (right, or left
 * in a right-to-left language), away from the indicator: half the indicator's width.
 */
const hoverSlide = createVar();

// The indicator's heights. home.png: 24 px when selected. A hovered entry's is 18 px: a clear
// bar, still shorter than the selection's. A hovered selected entry's grows to 32 px, so the
// selected entry answers the pointer too and reads as something to press.
const indicatorHeight = 24;
const hoverIndicatorScale = 18 / indicatorHeight;
const selectedHoverIndicatorScale = 32 / indicatorHeight;

/** A rail button whose menu is open (`useSidebarContextMenu`): it looks hovered until it closes. */
const menuOpen = '[data-menu-open=true]';

/** A hovered entry, or one whose button has keyboard focus or an open menu. */
const entryEngaged = [
  '&:hover::before',
  '&:has(> :focus-visible)::before',
  `&:has(> ${menuOpen})::before`,
].join(', ');

/** A rail entry: the avatar button with its selection indicator and unread badge. */
export const SidebarItem = recipe({
  base: [
    sidebarItemRoot,
    DefaultReset,
    // Centring also places the absolutely positioned indicator vertically.
    Centered,
    {
      position: 'relative',
      vars: { [hoverSlide]: toRem(2) },
      selectors: {
        '[dir=rtl] &': { vars: { [hoverSlide]: toRem(-2) } },
        // The indicator: a pill on the rail's outer edge (the left one, or the right one in a
        // right-to-left language). home.png: 4 px wide, flush with the edge (12 px before the
        // 42 px avatar). Its inner end is round. It grows from nothing to its hover height and
        // back, and to its full height while the entry is selected (taller still on hover).
        '&::before': {
          content: '',
          position: 'absolute',
          insetInlineStart: `calc(-1 * ${toRem(12)})`,
          inlineSize: toRem(4),
          blockSize: toRem(indicatorHeight),
          borderStartStartRadius: 0,
          borderEndStartRadius: 0,
          borderStartEndRadius: config.radii.Pill,
          borderEndEndRadius: config.radii.Pill,
          backgroundColor: color.Background.OnContainer,
          transform: 'scaleY(0)',
          transition: `transform ${motion.duration.Slow} ${motion.easing.Standard}`,
        },
        [entryEngaged]: { transform: `scaleY(${hoverIndicatorScale})` },
      },
    },
  ],
  variants: {
    active: {
      true: {
        selectors: {
          '&::before': { transform: 'none' },
          // After the base hover rule, which it outranks by coming later.
          [entryEngaged]: { transform: `scaleY(${selectedHoverIndicatorScale})` },
        },
      },
    },
  },
});

/** A rail button's fill: `percent` of `tone`, with the rail showing through the rest. */
const railButtonFill = (tone: string, percent: number) =>
  `color-mix(in srgb, ${tone} ${percent}%, transparent)`;

/**
 * A pressed rail button, by the pointer or by the Space key. Inside the entry and doubled, to
 * outrank the glass material's `button&:active:not(:disabled)` press.
 */
const pressed = `${sidebarItemRoot} &&:active`;

/** The theme classes whose palettes are dark. */
const darkThemes = ':is(.dark-theme, .midnight-theme, .butter-theme, .green-theme, .orange-theme)';

/** A raised rail button that is hovered, focused or has its menu open, under `scope`. */
const raisedEngaged = (scope: string) =>
  [':hover', ':focus-visible', menuOpen].map((state) => `${scope}&&&${state}`).join(', ');

/** The 42 px rounded square that a rail entry's icon or avatar fills. */
export const SidebarAvatar = recipe({
  base: [
    DefaultReset,
    Centered,
    {
      flex: 'none',
      overflow: 'hidden',
      padding: 0,
      border: 0,
      borderRadius: config.radii.R500,
      color: color.Background.OnContainer,
      background: 'none',
      cursor: 'pointer',
      outline: 'none',
      // The slide follows the entry, not the button: the entry keeps the pointer when the button
      // has moved out from under it. Reduced motion keeps the indicator and drops the slide and
      // the press.
      '@media': {
        '(prefers-reduced-motion: reduce)': {
          selectors: {
            [`${sidebarItemRoot}:hover &, &:focus-visible, &${menuOpen}`]: { translate: 'none' },
            [pressed]: { scale: 'none' },
          },
        },
        // A finger gets 44 px: a layer 1 px larger on every side. It is laid out from the
        // entry, which is the button's size, so the button's own clipping (round avatars)
        // leaves it alone; a raised button, which is positioned, stops clipping instead.
        '(pointer: coarse)': {
          selectors: {
            '&::after': {
              content: '""',
              position: 'absolute',
              insetBlock: `min(0px, calc((100% - ${toRem(44)}) / 2))`,
              insetInline: `min(0px, calc((100% - ${toRem(44)}) / 2))`,
            },
          },
        },
      },
      selectors: {
        // Doubled to outrank the glass material's `button&` transition, which only names `scale`
        // (its hover grow); both properties ease back at the normal pace.
        '&&': {
          transition: `scale ${motion.duration.Normal} cubic-bezier(0.2, 0.8, 0.2, 1), translate ${motion.duration.Normal} ease-out`,
        },
        // Keyboard focus and an open menu look like hover.
        [`${sidebarItemRoot}:hover &, &:focus-visible, &${menuOpen}`]: {
          translate: `${hoverSlide} 0`,
        },
        // Pressing keeps the slide and quickly shrinks the button a little; the entry, and so
        // the layout and the indicator, stay put.
        [pressed]: {
          scale: '0.95',
          transition: `scale ${motion.duration.Instant} ease-out, translate ${motion.duration.Normal} ease-out`,
        },
        [`&:hover, &${menuOpen}`]: { backgroundColor: color.SurfaceVariant.ContainerHover },
        '&:active': { backgroundColor: color.SurfaceVariant.ContainerActive },
        // An outline, not a ring shadow: the glass material of raised buttons owns box-shadow.
        '&:focus-visible': {
          outline: `${toRem(2)} solid ${color.Primary.Main}`,
          outlineOffset: toRem(2),
        },
      },
    },
  ],
  variants: {
    // Folds Avatar sizes: 400 is 2.625rem (42 px, the rail avatars in home.png).
    size: {
      '400': { width: toRem(42), height: toRem(42) },
      '300': { width: toRem(34), height: toRem(34) },
      '200': { width: toRem(26), height: toRem(26) },
    },
    // The raised button of a rail section. SidebarAvatar adds the glass control material for
    // its rim and shadow; the fill is a deeper grey than the material's, as in home.png, and a
    // hairline in the rail's line colour runs around the outside of the rim.
    outlined: {
      true: {
        position: 'relative',
        '@media': { '(pointer: coarse)': { overflow: 'visible' } },
        color: color.Secondary.OnContainer,
        selectors: {
          '&&&': {
            backgroundColor: railButtonFill(color.Secondary.ContainerActive, 82),
            border: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
          },
          [raisedEngaged('')]: {
            backgroundColor: railButtonFill(color.Secondary.ContainerLine, 82),
          },
          // room-dark.png: on dark rails the button barely lifts off the rail; its rim shows it.
          [`${darkThemes} &&&`]: {
            backgroundColor: railButtonFill(color.Background.ContainerHover, 10),
          },
          [raisedEngaged(`${darkThemes} `)]: {
            backgroundColor: railButtonFill(color.Background.ContainerActive, 50),
          },
        },
      },
    },
  },
  defaultVariants: { size: '400', outlined: false },
});

/**
 * Offsets that put the badge's top-start corner (top-left, or top-right in a right-to-left
 * language) `distance` px outside the entry's.
 */
const cornerOffset = (distance: number) => ({
  top: toRem(distance),
  insetInlineStart: toRem(distance),
});

/** The unread badge, pinned over the top-start corner of the rail entry. */
export const SidebarItemBadge = recipe({
  // A flex box, so the badge sits at its top instead of on a text line's baseline below it.
  base: { position: 'absolute', zIndex: 1, pointerEvents: 'none', display: 'flex' },
  variants: {
    // home.png: the unread count sits 6 px outside the avatar's top-left corner.
    hasCount: {
      true: cornerOffset(-6),
      false: cornerOffset(-2),
    },
  },
  defaultVariants: { hasCount: false },
});
