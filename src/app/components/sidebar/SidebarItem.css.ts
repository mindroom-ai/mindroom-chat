import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../../styles/Motion.css';

// Measured from docs/design/reference/home.png (1440x900 at 1x): the rail is 66 px wide and
// holds 42 px avatars (folds Avatar size 400 is 2.625rem) at 12 px from the edge (S300), 12 px
// apart (S300), starting 12 px from the top (S300), with 12 px corners (folds R500). Task 8's
// sidebar/Sidebar.css.ts keeps only the drag source styles; the rail and stack are defined here
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

/** Marks the rail entry, so its avatar can react to the entry being hovered or pressed. */
const sidebarItemRoot = style({});

/** How far a hovered rail button lifts. */
const hoverLift = toRem(-2);

/** A rail entry: the avatar button with its selection pill and unread badge. */
export const SidebarItem = recipe({
  base: [
    sidebarItemRoot,
    DefaultReset,
    // Centring also places the absolutely positioned pill vertically.
    Centered,
    {
      position: 'relative',
      selectors: {
        // The selected tab's indicator: a pill on the rail's outer edge (the left one, or the
        // right one in a right-to-left language). home.png: 4 px wide and 24 px tall when
        // selected, flush with the edge (12 px before the 42 px avatar). Its inner end is round.
        '&::before': {
          content: '',
          position: 'absolute',
          insetInlineStart: `calc(-1 * ${toRem(12)})`,
          inlineSize: toRem(4),
          blockSize: toRem(16),
          borderStartStartRadius: 0,
          borderEndStartRadius: 0,
          borderStartEndRadius: config.radii.Pill,
          borderEndEndRadius: config.radii.Pill,
          backgroundColor: color.Background.OnContainer,
          transform: 'scaleY(0)',
          transition: 'transform 200ms ease',
        },
        '&:hover::before': { transform: 'scaleY(0.6)' },
      },
    },
  ],
  variants: {
    active: {
      true: {
        selectors: {
          '&::before, &:hover::before': { transform: 'scaleY(1.5)' },
        },
      },
    },
  },
});

/** A rail button's fill: `percent` of `tone`, with the rail showing through the rest. */
const railButtonFill = (tone: string, percent: number) =>
  `color-mix(in srgb, ${tone} ${percent}%, transparent)`;

/** The theme classes whose palettes are dark. */
const darkThemes = ':is(.dark-theme, .midnight-theme, .butter-theme)';

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
      // The lift follows the entry, not the button: the entry keeps the pointer when the button
      // has risen out from under it. Reduced motion keeps the indicator and drops the lift.
      '@media': {
        '(prefers-reduced-motion: reduce)': {
          selectors: { [`${sidebarItemRoot}:hover &`]: { translate: 'none' } },
        },
      },
      selectors: {
        // Doubled to outrank the glass material's `button&` transition, which only names `scale`
        // (its hover grow); both properties ease.
        '&&': {
          transition: `scale 180ms cubic-bezier(0.2, 0.8, 0.2, 1), translate ${motion.duration.Normal} ease-out`,
        },
        [`${sidebarItemRoot}:hover &`]: { translate: `0 ${hoverLift}` },
        // Pressing settles the button back down.
        [`${sidebarItemRoot}:hover &:active`]: { translate: 'none' },
        '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
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
        color: color.Secondary.OnContainer,
        selectors: {
          '&&&': {
            backgroundColor: railButtonFill(color.Secondary.ContainerActive, 82),
            border: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
          },
          '&&&:hover, &&&:focus-visible': {
            backgroundColor: railButtonFill(color.Secondary.ContainerLine, 82),
          },
          // room-dark.png: on dark rails the button barely lifts off the rail; its rim shows it.
          [`${darkThemes} &&&`]: {
            backgroundColor: railButtonFill(color.Background.ContainerHover, 10),
          },
          [`${darkThemes} &&&:hover, ${darkThemes} &&&:focus-visible`]: {
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
