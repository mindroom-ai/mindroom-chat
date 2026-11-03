import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

const arrive = keyframes({
  from: { opacity: 0, transform: `translateY(${toRem(4)})` },
  to: { opacity: 1, transform: 'none' },
});

// A small glass strip above the composer, inset like the approval bar and the composer card.
export const TypingStrip = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    // The strip hugs its text, up to the composer's width.
    inlineSize: 'fit-content',
    maxInlineSize: `calc(100% - 2 * ${config.space.S400})`,
    minWidth: 0,
    marginInline: config.space.S400,
    marginBlockEnd: config.space.S200,
    paddingBlock: toRem(2),
    paddingInlineStart: config.space.S300,
    paddingInlineEnd: toRem(2),
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    '@media': {
      '(prefers-reduced-motion: no-preference)': {
        animation: `${arrive} 160ms ease-out`,
      },
    },
  },
]);

export const TypingText = style({
  flexGrow: 1,
  minWidth: 0,
});

const hop = keyframes({
  '0%, 60%, 100%': { transform: 'none', opacity: 0.45 },
  '30%': { transform: `translateY(${toRem(-3)})`, opacity: 1 },
});

// The dots take the accent color; each one is a filled circle of that color.
export const TypingDots = style({
  color: color.Primary.Main,
  gap: toRem(3),
  display: 'flex',
  flex: 'none',
});

export const TypingDot = style({
  inlineSize: toRem(5),
  blockSize: toRem(5),
  borderRadius: '50%',
  backgroundColor: 'currentColor',
  opacity: 0.6,
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animation: `${hop} 1.2s ease-in-out infinite`,
      selectors: {
        '&:nth-child(2)': { animationDelay: '150ms' },
        '&:nth-child(3)': { animationDelay: '300ms' },
      },
    },
  },
});
