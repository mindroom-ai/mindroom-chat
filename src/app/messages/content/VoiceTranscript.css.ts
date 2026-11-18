import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const sweep = keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(100%)' },
});

export const Transcript = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockStart: config.space.S200,
  minWidth: 0,
});

export const Lines = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  // As wide as a short transcript, never wider than the message.
  width: toRem(240),
  maxWidth: '100%',
  paddingBlock: toRem(3),
});

export const Line = style({
  position: 'relative',
  overflow: 'hidden',
  height: toRem(10),
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  // The second line is shorter, as the last line of a paragraph.
  selectors: { '&:last-child': { width: '60%' } },
  '::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    backgroundImage: `linear-gradient(90deg, transparent, ${color.SurfaceVariant.ContainerActive}, transparent)`,
    animation: `${sweep} 1.6s ease-in-out infinite`,
    willChange: 'transform',
  },
  '@media': {
    '(prefers-reduced-motion: reduce), (forced-colors: active)': {
      '::after': { display: 'none', animation: 'none' },
    },
    '(forced-colors: active)': {
      backgroundColor: 'GrayText',
    },
  },
});
