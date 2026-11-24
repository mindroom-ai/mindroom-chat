import { keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';

const BLOOM_MS = 360;

const ringBloom = keyframes({
  from: { opacity: 0, transform: 'scale(0.86)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

const focusRing = {
  outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
  outlineOffset: '2px',
};

export const Root = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  inlineSize: '100%',
  maxInlineSize: toRem(440),
  marginBlock: 'auto',
  marginInline: 'auto',
  paddingBlock: config.space.S500,
  paddingInline: config.space.S400,
  textAlign: 'center',
});

export const LoadingState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: config.space.S200,
});

export const IconRing = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  inlineSize: toRem(44),
  blockSize: toRem(44),
  borderRadius: '50%',
  border: `${toRem(1.5)} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  marginBlockEnd: config.space.S300,
  flexShrink: 0,
});

export const IconRingSuccess = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const IconRingSuccessAnimated = style({
  animation: `${ringBloom} ${BLOOM_MS}ms ${motion.easing.Decelerate} both`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

export const Heading = style({
  marginBlock: 0,
  color: color.Surface.OnContainer,
});

export const SummaryRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'center',
  columnGap: config.space.S200,
  rowGap: config.space.S100,
  marginBlockStart: config.space.S100,
});

export const Separator = style({
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  userSelect: 'none',
});

export const InlineLink = style([
  DefaultReset,
  {
    color: color.Primary.Main,
    fontSize: config.fontSize.T300,
    fontWeight: 500,
    lineHeight: config.lineHeight.T300,
    cursor: 'pointer',
    borderRadius: config.radii.R300,
    transition: transition(['color', 'opacity']),
    ':focus-visible': focusRing,
    selectors: {
      '&:hover': {
        textDecoration: 'underline',
        textUnderlineOffset: toRem(2),
      },
    },
  },
]);

export const Subtitle = style({
  marginBlockStart: config.space.S100,
  maxInlineSize: toRem(360),
});

export const Actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S200,
  marginBlockStart: config.space.S400,
});

export const SecondaryActionButton = style({
  borderColor: color.SurfaceVariant.ContainerLine,
  selectors: {
    '&:hover:not(:disabled), &:active:not(:disabled)': {
      borderColor: color.SurfaceVariant.ContainerLine,
    },
  },
});

export const PeekSection = style({
  inlineSize: '100%',
  marginBlockStart: config.space.S500,
  textAlign: 'start',
});

export const PeekHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingInline: config.space.S100,
  marginBlockEnd: config.space.S200,
});

export const PeekLabel = style({
  marginBlock: 0,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const PeekList = style({
  listStyle: 'none',
  marginBlock: 0,
  marginInline: 0,
  paddingBlock: 0,
  paddingInline: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
});

export const PeekRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minInlineSize: 0,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  transition: transition(['background-color', 'border-color']),
  '@media': {
    '(hover: hover)': {
      selectors: {
        '&:hover': {
          backgroundColor: color.SurfaceVariant.ContainerHover,
        },
      },
    },
  },
});

export const PeekThreadButton = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    flex: '1 1 auto',
    minInlineSize: 0,
    paddingBlock: config.space.S100,
    paddingInline: config.space.S100,
    borderRadius: config.radii.R300,
    color: color.SurfaceVariant.OnContainer,
    textAlign: 'start',
    cursor: 'pointer',
    ':focus-visible': focusRing,
  },
]);

export const PeekCheckIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  inlineSize: toRem(18),
  blockSize: toRem(18),
  borderRadius: '50%',
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const PeekTitle = style({
  flex: '1 1 auto',
  minInlineSize: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const PeekTime = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const ReopenButton = style([
  DefaultReset,
  {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    paddingBlock: config.space.S100,
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
    fontSize: config.fontSize.T200,
    fontWeight: 500,
    lineHeight: config.lineHeight.T200,
    cursor: 'pointer',
    transition: transition(['background-color', 'border-color', 'opacity']),
    ':focus-visible': focusRing,
    selectors: {
      '&:hover:not(:disabled)': {
        backgroundColor: color.Surface.ContainerHover,
      },
      '&:disabled': {
        opacity: config.opacity.Disabled,
        cursor: 'default',
      },
    },
  },
]);

export const WhisperRow = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S100,
  marginBlockStart: config.space.S400,
  color: color.Surface.OnContainer,
});

export const WhisperIcon = style({
  opacity: config.opacity.P400,
  flexShrink: 0,
});
