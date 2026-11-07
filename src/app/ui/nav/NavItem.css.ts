import { createVar, globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../styles/Motion.css';

const variant = (name: 'Background' | 'Surface' | 'SurfaceVariant' | 'Primary' | 'Secondary') => ({
  vars: {
    '--nav-item-hover': color[name].ContainerHover,
    '--nav-item-active': color[name].ContainerActive,
    '--nav-item-on': color[name].OnContainer,
  },
});

// A flex box that centres its children on the cross axis.
const centeredFlex = { display: 'flex', alignItems: 'center' } as const;

// Flex box that also takes the space left in its row; `minWidth: 0` lets long text shrink it.
const fillingFlex = { ...centeredFlex, flexGrow: 1, minWidth: 0 } as const;

/** Every sidebar row, whatever its variant: the hook for rules about what sits inside it. */
const NavItemRow = style({});

// A sidebar row. Its action (NavButton or NavLink) fills it; NavItemOptions sit at its end.
export const NavItem = recipe({
  base: [
    NavItemRow,
    DefaultReset,
    centeredFlex,
    {
      position: 'relative',
      minBlockSize: toRem(36),
      inlineSize: '100%',
      // Rows read at body size T300 (14 px) in medium weight, as in docs/design/reference/home.png:
      // at 500 a row's text matches the reference's width and ink to the pixel, at 400 it has
      // about 18% less ink and reads thin.
      fontSize: config.fontSize.T300,
      lineHeight: config.lineHeight.T300,
      fontWeight: config.fontWeight.W500,
      color: 'var(--nav-item-on)',
      outline: 'none',
      selectors: {
        // A row whose menu is open keeps the tint it had under the pointer or the finger.
        '&:focus-within, &[data-menu-open=true]': {
          backgroundColor: 'var(--nav-item-hover)',
        },
        '&[data-selected=true]': { backgroundColor: 'var(--nav-item-active)' },
      },
      '@media': {
        // A touch screen keeps :hover on the row tapped last; only a pointer that can hover tints it.
        '(hover: hover)': {
          selectors: {
            '&:hover:not([data-selected=true])': { backgroundColor: 'var(--nav-item-hover)' },
          },
        },
      },
    },
  ],
  variants: {
    variant: {
      Background: variant('Background'),
      Surface: variant('Surface'),
      SurfaceVariant: variant('SurfaceVariant'),
      Primary: variant('Primary'),
      Secondary: variant('Secondary'),
    },
    radii: {
      '0': { borderRadius: 0 },
      '300': { borderRadius: config.radii.R300 },
      // Page navigation rows have 12px corners (docs/design/reference/room-dark.png: the open
      // row fits 12.2px), folds' R500. Callers ask for a row with "400", so that name takes it.
      '400': { borderRadius: config.radii.R500 },
      '500': { borderRadius: config.radii.R500 },
      Pill: { borderRadius: config.radii.Pill },
    },
    highlight: {
      true: { fontWeight: config.fontWeight.W600 },
    },
  },
  defaultVariants: {
    variant: 'Background',
    radii: '400',
  },
});

export const NavAction = style([
  DefaultReset,
  fillingFlex,
  {
    color: 'inherit',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'start',
    borderRadius: 'inherit',
    outline: 'none',
    selectors: {
      '&:focus-visible': {
        boxShadow: `inset 0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
      },
    },
  },
]);

export const NavItemContent = style([
  DefaultReset,
  fillingFlex,
  {
    gap: config.space.S200,
    minBlockSize: toRem(36),
    paddingInline: config.space.S200,
  },
]);

export const NavItemOptions = style([
  centeredFlex,
  { flexShrink: 0, gap: config.space.S100, paddingInlineEnd: config.space.S100 },
]);

/** How far a row's hidden controls sit toward the row's end before they slide in. */
const revealShift = createVar();
const revealTiming = `${motion.duration.Normal} ${motion.easing.Standard}`;

/**
 * Row controls that fade in while sliding in from the row's inline end when the row is hovered or
 * holds focus, and leave the same way. Hidden, they stay mounted but take no pointer and no focus
 * (`visibility` switches only after the fade out ends). Reduced motion keeps the fade alone, and
 * `src/index.css` shortens even that.
 */
export const rowControlsHidden = {
  opacity: 0,
  transform: `translateX(${revealShift})`,
  visibility: 'hidden',
  pointerEvents: 'none',
  transition: `opacity ${revealTiming}, transform ${revealTiming}, visibility 0s linear ${motion.duration.Normal}`,
} as const;

export const rowControlsShown = {
  opacity: 1,
  transform: 'none',
  visibility: 'visible',
  pointerEvents: 'auto',
  transition: `opacity ${revealTiming}, transform ${revealTiming}, visibility 0s`,
} as const;

export const rowControlsShift = style({
  vars: { [revealShift]: toRem(6) },
  selectors: { '[dir=rtl] &': { vars: { [revealShift]: toRem(-6) } } },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      vars: { [revealShift]: '0px' },
      selectors: { '[dir=rtl] &': { vars: { [revealShift]: '0px' } } },
    },
  },
});

/**
 * Options laid over the end of their row (`data-shown` says whether they show), so the row's text
 * stays where it is while they come and go. Shown, they keep the row's action clear of them.
 */
export const NavItemOptionsReveal = style([
  rowControlsShift,
  {
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: 0,
    ...rowControlsHidden,
    selectors: { '&[data-shown=true]': rowControlsShown },
  },
]);

/** The width of a row's one options button (folds IconButton size 300) and its end padding. */
const OPTIONS_WIDTH = `calc(${toRem(32)} + ${config.space.S100})`;
globalStyle(
  `${NavItemRow}:has(> ${NavItemOptionsReveal}[data-shown=true]) > :not(${NavItemOptionsReveal})`,
  {
    paddingInlineEnd: OPTIONS_WIDTH,
  }
);

export const NavCategory = style([DefaultReset, { position: 'relative' }]);

// An empty list's message stands in the middle of the space the list would fill.
const centeredColumn = {
  ...centeredFlex,
  flexGrow: 1,
  flexFlow: 'column',
  justifyContent: 'center',
} as const;

export const NavEmptyCenter = style(centeredColumn);

export const NavEmptyLayout = style([
  centeredColumn,
  { gap: config.space.S400, padding: config.space.S500, textAlign: 'center' },
]);
