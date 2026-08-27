import { keyframes, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

const shimmer = keyframes({
  '0%': { backgroundPosition: '180% 50%' },
  '100%': { backgroundPosition: '-80% 50%' },
});

const think = keyframes({
  '0%, 100%': {
    opacity: 0.35,
    transform: 'scale(0.55)',
  },
  '35%': {
    opacity: 1,
    transform: 'scale(1)',
  },
  '70%': {
    opacity: 0.55,
    transform: 'scale(0.72)',
  },
});

export const Placeholder = style({
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '100%',
  gap: config.space.S100,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 700,
  verticalAlign: 'baseline',
});

export const Indicator = style({
  position: 'relative',
  flex: '0 0 auto',
  width: '0.875em',
  height: '0.875em',
  color: color.Primary.Main,
});

export const Dot = style({
  position: 'absolute',
  width: '3px',
  height: '3px',
  borderRadius: '999px',
  backgroundColor: 'currentColor',
  animation: `${think} 1.2s ease-in-out infinite`,
  selectors: {
    '&:nth-child(1)': {
      top: 0,
      left: 'calc(50% - 1.5px)',
    },
    '&:nth-child(2)': {
      top: 'calc(50% - 1.5px)',
      right: 0,
      animationDelay: '-900ms',
    },
    '&:nth-child(3)': {
      bottom: 0,
      left: 'calc(50% - 1.5px)',
      animationDelay: '-600ms',
    },
    '&:nth-child(4)': {
      top: 'calc(50% - 1.5px)',
      left: 0,
      animationDelay: '-300ms',
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      opacity: 0.75,
      transform: 'scale(0.72)',
    },
  },
});

export const Text = style({
  display: 'inline-block',
  maxWidth: '100%',
  color: 'transparent',
  backgroundImage: `linear-gradient(100deg, ${color.Secondary.Main} 0%, ${color.Primary.Main} 36%, ${color.Surface.OnContainer} 50%, ${color.Primary.Main} 64%, ${color.Secondary.Main} 100%)`,
  backgroundSize: '220% 100%',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  animation: `${shimmer} 2.2s linear infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      color: 'inherit',
      backgroundImage: 'none',
    },
  },
});
