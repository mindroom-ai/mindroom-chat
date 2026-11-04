import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

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

// A sidebar row. Its action (NavButton or NavLink) fills it; NavItemOptions sit at its end.
export const NavItem = recipe({
  base: [
    DefaultReset,
    centeredFlex,
    {
      position: 'relative',
      minBlockSize: toRem(36),
      inlineSize: '100%',
      // Rows read at body size T300 (14 px), as in docs/design/reference/home.png.
      fontSize: config.fontSize.T300,
      lineHeight: config.lineHeight.T300,
      color: 'var(--nav-item-on)',
      outline: 'none',
      selectors: {
        '&:hover, &:focus-within': { backgroundColor: 'var(--nav-item-hover)' },
        '&[data-selected=true]': { backgroundColor: 'var(--nav-item-active)' },
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
      '400': { borderRadius: config.radii.R400 },
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
