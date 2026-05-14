import { keyframes, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

const shimmer = keyframes({
  '0%': { backgroundPosition: '180% 50%' },
  '100%': { backgroundPosition: '-80% 50%' },
});

export const Placeholder = style({
  display: 'inline-flex',
  alignItems: 'baseline',
  maxWidth: '100%',
  color: color.Secondary.Main,
  fontWeight: 600,
  verticalAlign: 'baseline',
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
      color: color.Secondary.Main,
      backgroundImage: 'none',
    },
  },
});

export const Ellipsis = style({
  color: color.Secondary.Main,
  paddingLeft: config.space.S100,
});
