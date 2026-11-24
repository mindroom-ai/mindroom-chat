import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../ui/styles/Motion.css';
import { transition } from '../ui/styles/transition';

export const SwipeIndicator = style({
  position: 'fixed',
  insetBlockStart: '50%',
  zIndex: config.zIndex.Max,
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  inlineSize: toRem(40),
  blockSize: toRem(40),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  boxShadow: config.shadow.E400,
  opacity: 0,
  transform: 'translate3d(var(--swipe-offset, 0px), -50%, 0) scale(0.92)',
  transition: transition(
    ['opacity', 'background-color', 'color', 'border-color'],
    motion.duration.Fast,
    motion.easing.Standard
  ),
  selectors: {
    '&[data-direction="back"]': { insetInlineStart: config.space.S400 },
    '&[data-direction="forward"]': { insetInlineEnd: config.space.S400 },
    '&[data-visible="true"]': { opacity: 'var(--swipe-opacity, 1)' },
    '&[data-armed="true"]': {
      backgroundColor: color.Primary.Main,
      color: color.Primary.OnMain,
      borderColor: color.Primary.Main,
      transform: 'translate3d(var(--swipe-offset, 0px), -50%, 0) scale(1)',
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transform: 'translate3d(0, -50%, 0)',
      selectors: { '&[data-armed="true"]': { transform: 'translate3d(0, -50%, 0)' } },
    },
  },
});

export const SwipeChevron = style({
  inlineSize: toRem(20),
  blockSize: toRem(20),
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});
