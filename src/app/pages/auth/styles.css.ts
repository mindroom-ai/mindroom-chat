import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';





  padding: `${toRem(48)} ${config.space.S300}`,
  position: 'relative',
  isolation: 'isolate',
  // Empty space passes pointer input through to the particle canvas behind the layout.
  pointerEvents: 'none',
});

globalStyle(
  `${AuthLayout} :is(a, button, input, select, textarea, label, [tabindex]:not([tabindex='-1']))`,
  { pointerEvents: 'auto' }
);

/** The persistent particle background shows through instead of the solid background. */
export const AuthLayoutPersistentParticle = style({
  backgroundColor: 'transparent',
});

// The card and the footer sit above the particle canvas and take pointer input again,
// although the layout passes it through.








  boxShadow: color.Surface.Container,
  zIndex: 1,
  position: 'relative',
  pointerEvents: 'auto',
});

/** The round logo in the card header; `X500` is 28px. */
export const AuthLogo = style([
  DefaultReset,
  {
    blockSize: config.size.X500,
    inlineSize: config.size.X500,






  paddingBlock: 0,
  paddingInline: config.space.S400,
});

/** Space between the card's sections, and under the last one. */
const sectionGap = toRem(44);





  gap: sectionGap,
  paddingInline: config.space.S400,
  paddingBlock: `${config.space.S700} ${sectionGap}`,
});




  position: 'relative',
  pointerEvents: 'auto',
});
