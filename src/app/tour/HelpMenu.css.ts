import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const MenuSurface = style({
  inlineSize: toRem(292),
  maxInlineSize: 'calc(100vw - 2rem)',
  maxBlockSize:
    'calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const MenuBody = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minBlockSize: 0,
});

export const Header = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingBlock: toRem(11),
  paddingInline: toRem(14),
});

export const Strong = style({ fontWeight: config.fontWeight.W600 });

export const TipPill = style({
  flexShrink: 0,
  paddingBlock: toRem(2),
  paddingInline: toRem(8),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  fontWeight: config.fontWeight.W600,
});

export const ScrollBody = style({
  flex: '1 1 auto',
  minBlockSize: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  scrollPaddingBlock: toRem(6),
});

export const Shrink = style({ flexShrink: 0 });

export const Suggested = style({
  margin: config.space.S200,
  paddingBlock: toRem(10),
  paddingInline: toRem(12),
  borderRadius: config.radii.R400,
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  border: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(4),
});

export const SuggestedHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
});

export const Eyebrow = style({
  fontSize: toRem(11),
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: color.Primary.Main,
  fontWeight: config.fontWeight.W600,
});

export const DismissTip = style({ marginInlineEnd: toRem(-4), marginBlock: toRem(-4) });

export const SuggestedActions = style({ marginBlockStart: toRem(6), display: 'flex' });

export const Guides = style({
  padding: config.space.S200,
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
});

export const GuidesHeading = style({
  fontSize: toRem(11),
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  paddingBlock: `${toRem(2)} ${toRem(4)}`,
  paddingInline: config.space.S200,
});

export const GuideRow = style({
  selectors: {
    '&&': {
      blockSize: 'auto',
      minBlockSize: toRem(34),
      paddingBlock: toRem(5),
      paddingInline: toRem(8),
    },
  },
});

export const StartLabel = style({ minInlineSize: 0, textAlign: 'start' });

export const SplitFooter = style({
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  alignItems: 'stretch',
});

export const FooterButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: toRem(6),
  minInlineSize: 0,
  minBlockSize: toRem(38),
  paddingBlock: toRem(8),
  paddingInline: config.space.S200,
  border: 0,
  backgroundColor: 'transparent',
  color: color.Surface.OnContainer,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.Surface.ContainerHover },
    '&:active': { backgroundColor: color.Surface.ContainerActive },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: `-${config.borderWidth.B400}`,
    },
  },
});

export const FooterEnd = style({
  borderInlineStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});
