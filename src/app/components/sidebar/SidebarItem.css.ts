import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

// Measured from docs/design/reference/home.png (1440x900 at 1x): the rail is 66 px wide and
// holds 42 px avatars (folds Avatar size 400 is 2.625rem) at 12 px from the edge (S300), 12 px
// apart (S300), starting 12 px from the top (S300). Task 8's sidebar/Sidebar.css.ts keeps only
// the drag source styles; the rail and stack are defined here once.

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

/** A rail entry: the avatar button with its selection pill and unread badge. */
export const SidebarItem = recipe({
  base: [
    DefaultReset,
    // Centring also places the absolutely positioned pill vertically.
    Centered,
    {
      position: 'relative',
      selectors: {
        // The selected tab's indicator: a pill on the rail's left edge. home.png: 4 px wide and
        // 24 px tall when selected, flush with the edge (12 px left of the 42 px avatar).
        '&::before': {
          content: '',
          position: 'absolute',
          left: `calc(-1 * ${toRem(12)})`,
          inlineSize: toRem(4),
          blockSize: toRem(16),
          borderRadius: `0 ${config.radii.Pill} ${config.radii.Pill} 0`,
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

/** The quiet grey of the corner action, with a hairline ring outside its edge. */
const secondaryCornerTone = {
  background: color.Secondary.Container,
  color: color.Secondary.OnContainer,
  boxShadow: `0 0 0 1px ${color.Secondary.ContainerLine}`,
};

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
      borderRadius: config.radii.R400,
      color: color.Background.OnContainer,
      background: 'none',
      cursor: 'pointer',
      outline: 'none',
      selectors: {
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
    // its rim and shadow; the fill is a deeper grey than the material's, as in home.png.
    outlined: {
      true: {
        position: 'relative',
        color: color.Secondary.OnContainer,
        selectors: {
          '&&&': { backgroundColor: railButtonFill(color.Secondary.ContainerActive, 82) },
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
    // A small round action pinned to the bottom-right corner of the entry it shares a
    // SidebarItem with. It fades in while that entry is hovered or holds focus, and stays
    // visible where nothing can hover.
    corner: {
      true: {
        position: 'absolute',
        right: toRem(-5),
        bottom: toRem(-5),
        zIndex: 1,
        inlineSize: toRem(20),
        blockSize: toRem(20),
        borderRadius: '50%',
        ...secondaryCornerTone,
        opacity: 0,
        transition: 'opacity 120ms ease',
        selectors: {
          '*:hover > &, *:focus-within > &': { opacity: 1 },
          '&:hover': { backgroundColor: color.Secondary.ContainerHover },
        },
        '@media': {
          '(hover: none)': { opacity: 1 },
          '(prefers-reduced-motion: reduce)': { transition: 'none' },
        },
      },
    },
  },
  defaultVariants: { size: '400', outlined: false, corner: false },
});

/** Offsets that put the badge's top-left corner `distance` px outside the entry's. */
const cornerOffset = (distance: number) => ({ top: toRem(distance), left: toRem(distance) });

/** The unread badge, pinned over the top-left corner of the rail entry. */
export const SidebarItemBadge = recipe({
  base: { position: 'absolute', zIndex: 1, pointerEvents: 'none' },
  variants: {
    // home.png: the unread count sits 6 px outside the avatar's top-left corner.
    hasCount: {
      true: cornerOffset(-6),
      false: cornerOffset(-2),
    },
  },
  defaultVariants: { hasCount: false },
});
