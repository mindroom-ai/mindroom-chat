import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

// Measured from docs/design/reference/home.png and room-light.png (1440x900 at 1x): the
// navigation column runs from the 66 px rail to the divider at x = 321, so it is 256 px wide; its
// header is folds Header size 600 (3.375rem, 54 px) with the title 12 px in (S300) and the menu
// button 16 px from the divider (S400); rows start 8 px below the header and 8 px from the rail
// (S200) and are 36 px apart (the row component). Everything else uses folds spacing tokens.






    minHeight: 0,
  },
  variants: {
    size: {
      '400': { width: toRem(256) },
      // A narrower column for dense layouts; no reference screenshot shows it.
      '300': { width: toRem(222) },
    },
  },
  defaultVariants: { size: '400' },
});

export const PageNavHeader = style({
  padding: `0 ${config.space.S400} 0 ${config.space.S300}`,
  flexShrink: 0,
  selectors: {
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

// Explore pages center their room grid; three 300 px cards with S400 gaps and padding fit.
export const PageContentCenter = style({







  DefaultReset,
  {
    padding: `${config.space.S700} 0`,
    maxWidth: toRem(360),
    width: '100%',
    margin: 'auto',
  },
]);
