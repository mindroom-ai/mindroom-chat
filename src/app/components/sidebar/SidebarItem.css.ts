import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

// Measured from docs/design/reference/home.png (1440x900 at 1x): the rail is 66 px wide and
// holds 42 px avatars (folds Avatar size 400 is 2.625rem) at 12 px from the edge (S300), 12 px
// apart (S300), starting 12 px from the top (S300). Task 8's sidebar/Sidebar.css.ts keeps only
// the drag source styles; the rail and stack are defined here once.

/** The rail: a fixed-width column, as tall as the client. */






    inlineSize: toRem(66),
    blockSize: '100%',













    inlineSize: '100%',
    paddingBlock: config.space.S300,
  },
]);

/** A short rule between two stacks. */
export const SidebarStackSeparator = style({
  width: toRem(24),
  height: config.borderWidth.B300,
  backgroundColor: color.Background.ContainerLine,
  marginInline: 'auto',

















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

/** The 42 px rounded square that a rail entry's icon or avatar fills. */















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
    outlined: {
      true: {



      },
    },
  },
  defaultVariants: { size: '400', outlined: false },
});

/** The unread badge, pinned over the top-left corner of the rail entry. */









      true: { top: toRem(-6), left: toRem(-6) },
      false: { top: toRem(-2), left: toRem(-2) },
    },
  },
  defaultVariants: { hasCount: false },
});
