import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';






    minHeight: 0,
  },
  variants: {
    size: {
      '400': { width: toRem(256) },
      '300': { width: toRem(222) },
    },
  },







    'button&': { cursor: 'pointer' },
    'button&[aria-pressed=true]': { backgroundColor: color.Background.ContainerActive },
    'button&:hover, button&:focus-visible': { backgroundColor: color.Background.ContainerHover },
    'button&:active': { backgroundColor: color.Background.ContainerActive },
  },
});

/** A navigation header that scrolls with the list below it. */
export const PageNavHeaderScroll = style({




















      true: { paddingLeft: config.space.S200 },
    },
    outlined: {
      true: { borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}` },
    },









    paddingBottom: config.space.S700,
  },
]);

export const PageContentCenter = style({






















  },
]);
