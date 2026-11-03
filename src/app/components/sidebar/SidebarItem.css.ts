import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';





















  },
]);

export const SidebarStackSeparator = style({
  width: toRem(24),
  height: config.borderWidth.B300,
  backgroundColor: color.Background.ContainerLine,











      position: 'relative',
      selectors: {
        // The selected tab's indicator: a pill on the sidebar's left edge.
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
          '&::before, &:hover::before': { transform: 'scaleY(1.75)' },
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
    size: {
      '400': { width: toRem(42), height: toRem(42) },
      '300': { width: toRem(34), height: toRem(34) },
      '200': { width: toRem(26), height: toRem(26) },
    },







});









      true: { top: toRem(-6), left: toRem(-6) },
      false: { top: toRem(-2), left: toRem(-2) },
    },
  },
  defaultVariants: { hasCount: false },
});
