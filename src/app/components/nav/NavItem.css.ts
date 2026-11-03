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









      width: '100%',
      color: 'var(--nav-item-on)',
      outline: 'none',
      selectors: {
        '&:hover, &:focus-within': { backgroundColor: 'var(--nav-item-hover)' },
        '&[aria-selected=true]': { backgroundColor: 'var(--nav-item-active)' },
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
  {
    display: 'flex',




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
  {
    display: 'flex',














});

export const NavCategory = style([DefaultReset, { position: 'relative' }]);

export const NavEmptyCenter = style({
  display: 'flex',




});

export const NavEmptyLayout = style({
  display: 'flex',





  textAlign: 'center',
});
