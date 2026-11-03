import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

// Measured from docs/design/reference/home.png (1440x900 at 1x): the rail is 66 px wide and
// holds 42 px avatars (folds Avatar size 400 is 2.625rem) at 12 px from the edge (S300), 12 px
// apart (S300), starting 12 px from the top (S300). Task 8's sidebar/Sidebar.css.ts keeps only
// the drag source styles; the rail and stack are defined here once.

























export const SidebarStackSeparator = style({
  width: toRem(24),
  height: config.borderWidth.B300,
  backgroundColor: color.Background.ContainerLine,











      position: 'relative',
      selectors: {
        // The selected tab's indicator: a pill on the rail's left edge. home.png: 4 px wide and
        // 24 px tall when selected, flush with the edge (12 px left of the 42 px avatar).
        '&::before': {
          content: '',
          position: 'absolute',
          left: `calc(-1 * ${toRem(12)})`,
          width: toRem(4),
          height: toRem(16),
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
















      outline: 'none',
      selectors: {
        '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
        '&:active': { backgroundColor: color.SurfaceVariant.ContainerActive },
        '&:focus-visible': {
          boxShadow: `0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
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







});








    // home.png: the unread count sits 6 px outside the avatar's top-left corner.
    hasCount: {
      true: { top: toRem(-6), left: toRem(-6) },
      false: { top: toRem(-2), left: toRem(-2) },
    },
  },
  defaultVariants: { hasCount: false },
});
