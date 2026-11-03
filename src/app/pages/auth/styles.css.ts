import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

/** The full-height sign-in page; the card and the footer are centred in it. */
export const AuthLayout = style({
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
  maxInlineSize: toRem(460),
  overflow: 'hidden',




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

/** The forms inside the card. */
export const AuthCardContent = style({
  minInlineSize: 0,
  gap: sectionGap,
  paddingInline: config.space.S400,
  paddingBlock: `${config.space.S700} ${sectionGap}`,
});

/** Credits and policy links under the card. */
export const AuthFooter = style({
  zIndex: 1,
  paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)',
  position: 'relative',
  pointerEvents: 'auto',
});
