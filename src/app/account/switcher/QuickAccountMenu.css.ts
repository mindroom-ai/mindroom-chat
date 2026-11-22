import { createVar, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';

const enterOffset = createVar();
const rowNudge = createVar();
const arrowSlide = createVar();

const menuEnter = keyframes({
  from: {
    opacity: 0,
    transform: `translateY(${enterOffset}) scale(0.96)`,
  },
  to: {
    opacity: 1,
    transform: 'translateY(0) scale(1)',
  },
});

export const MenuSurface = style({
  inlineSize: toRem(236),
  maxInlineSize: 'calc(100vw - 2rem)',
  maxBlockSize:
    'calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  vars: {
    [enterOffset]: toRem(4),
  },
  animation: `${menuEnter} ${motion.duration.Fast} ${motion.easing.Decelerate}`,
  selectors: {
    '&[data-below="true"]': {
      vars: {
        [enterOffset]: toRem(-4),
      },
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

export const Header = style({
  flexShrink: 0,
  paddingBlock: `${toRem(8)} ${toRem(4)}`,
  paddingInline: toRem(12),
});

export const Heading = style({
  fontSize: toRem(11),
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
});

export const AccountList = style({
  flex: '1 1 auto',
  minBlockSize: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  paddingBlock: `${toRem(2)} ${toRem(6)}`,
  paddingInline: config.space.S100,
});

export const AccountRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minBlockSize: toRem(44),
  paddingBlock: toRem(6),
  paddingInline: toRem(8),
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid transparent`,
  backgroundColor: 'transparent',
  color: color.Surface.OnContainer,
  vars: {
    [rowNudge]: toRem(2),
  },
  transition: transition(
    ['background-color', 'border-color', 'color', 'transform'],
    motion.duration.Instant,
    motion.easing.Standard
  ),
  selectors: {
    '[dir=rtl] &': {
      vars: {
        [rowNudge]: toRem(-2),
      },
    },
    '&[data-highlighted="true"]': {
      backgroundColor: color.Primary.Container,
      borderColor: color.Primary.ContainerLine,
      color: color.Primary.OnContainer,
      transform: `translateX(${rowNudge})`,
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      selectors: {
        '&[data-highlighted="true"]': {
          transform: 'none',
        },
      },
    },
  },
});

export const AvatarShrink = style({
  flexShrink: 0,
});

export const TextColumn = style({
  minInlineSize: 0,
  flexGrow: 1,
  textAlign: 'start',
});

export const TrailingArrow = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  color: color.Primary.Main,
  opacity: 0,
  vars: {
    [arrowSlide]: toRem(-4),
  },
  transform: `translateX(${arrowSlide})`,
  transition: transition(['opacity', 'transform'], motion.duration.Instant, motion.easing.Standard),
  selectors: {
    '[dir=rtl] &': {
      vars: {
        [arrowSlide]: toRem(4),
      },
    },
    '&[data-highlighted="true"]': {
      opacity: 1,
      transform: 'translateX(0)',
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transform: 'none',
      selectors: {
        '&[data-highlighted="true"]': {
          transform: 'none',
        },
      },
    },
  },
});

export const TrailingArrowIcon = style({
  selectors: {
    '[dir=rtl] &': {
      transform: 'scaleX(-1)',
    },
  },
});

export const HoldTrigger = style({
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  selectors: {
    '&[data-quick-switch-enabled="true"]': {
      touchAction: 'none',
    },
    '&&[data-quick-switch-pressing="true"]': {
      scale: '0.94',
      boxShadow: `0 0 0 ${toRem(2)} ${color.Primary.Main}`,
      transition: transition(
        ['scale', 'box-shadow'],
        motion.duration.Instant,
        motion.easing.Standard
      ),
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      selectors: {
        '&&[data-quick-switch-pressing="true"]': {
          scale: 'none',
        },
      },
    },
  },
});
