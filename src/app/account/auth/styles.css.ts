import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

/**
 * The page's scroller. A folds vertical `Scroll` always scrolls, which keeps a gutter at the end
 * edge, and pads that edge where scrollbars overlay the page; either way a strip at the edge shows
 * the plain page instead of the particles. Here a scrollbar appears only when the page overflows.
 */
export const AuthScroll = style({
  selectors: {
    '&&&': { overflowY: 'auto', paddingInlineEnd: 0 },
  },
});

/** The full-height sign-in page; the card and the footer are centred in it. */
export const AuthLayout = style({
  // Laid out by a folds `Box`, which brings `display: flex`.
  flexFlow: 'column',
  rowGap: config.space.S400,
  alignItems: 'center',
  justifyContent: 'center',
  minBlockSize: '100%',
  color: color.Background.OnContainer,
  backgroundColor: color.Background.Container,
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

/** The sign-in card: full width on phones, capped on wider screens. */
export const AuthCard = style({
  inlineSize: '100%',
  position: 'relative',
  zIndex: 1,
  maxInlineSize: toRem(460),
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  boxShadow: color.Surface.Container,
  overflow: 'hidden',
  color: color.Surface.OnContainer,
  backgroundColor: color.Surface.Container,
  pointerEvents: 'auto',
});

/** The logo in the card header, whole and uncropped, 28px (`X500`) high. */
export const AuthLogo = style([
  DefaultReset,
  {
    objectFit: 'contain',
    blockSize: config.size.X500,
    inlineSize: config.size.X500,
  },
]);

/**
 * A deployment's own logo keeps its proportions at the same height, up to a wordmark's width, and
 * leaves the shrinking to the title beside it.
 */
export const AuthLogoCustom = style({
  flexShrink: 0,
  inlineSize: 'auto',
  maxInlineSize: toRem(160),
});

/** The page's heading when it is the logo alone: a wordmark that shows the name. */
export const AuthLogoHeading = style([DefaultReset, { display: 'flex' }]);

/** The card's title bar with the logo and the app name. */
export const AuthHeader = style({
  padding: `0 ${config.space.S400}`,
});

/** Space between the card's sections, and under the last one. */
const sectionGap = toRem(44);

/** The forms inside the card, inset from its edges as far as the sections are apart. */
export const AuthCardContent = style({
  minInlineSize: 0,
  gap: sectionGap,
  paddingInline: sectionGap,
  paddingBlock: `${config.space.S700} ${sectionGap}`,
  '@media': {
    // Phones keep the narrower inset, so the fields stay wide enough to type in.
    'screen and (max-width: 480px)': { paddingInline: config.space.S400 },
  },
});

/** Credits and policy links under the card. */
export const AuthFooter = style({
  zIndex: 1,
  paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)',
  position: 'relative',
  pointerEvents: 'auto',
});
