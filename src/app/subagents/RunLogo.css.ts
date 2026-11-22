import { createVar, fallbackVar, keyframes, style, styleVariants } from '@vanilla-extract/css';
import { color, config } from 'folds';

// The tile's size, which the jobs bar's grid shares; a card's own unless set.
export const logoSize = createVar();
// The background behind a logo, which its status dot's ring takes so it never shows as a halo.
export const logoRing = createVar();

// The run's model, the agent's picture or a terminal, on a tile that stands out from its row.
export const Logo = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: fallbackVar(logoSize, config.size.X500),
  blockSize: fallbackVar(logoSize, config.size.X500),
  borderRadius: config.radii.R300,
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  boxShadow: `inset 0 0 0 1px ${color.SurfaceVariant.ContainerLine}`,
});

const pulse = keyframes({ '50%': { opacity: 0.45 } });
const statusDot = {
  position: 'absolute',
  insetBlockEnd: '-3px',
  insetInlineEnd: '-3px',
  inlineSize: '0.625rem',
  blockSize: '0.625rem',
  borderRadius: '50%',
  border: `2px solid ${fallbackVar(logoRing, color.Surface.Container)}`,
} as const;

// The dot says how the run stands; the words beside the logo say it too.
export const Dot = styleVariants({
  running: [
    statusDot,
    {
      background: color.Success.Main,
      '@media': {
        '(prefers-reduced-motion: no-preference)': {
          animation: `${pulse} 2s ease-in-out infinite`,
        },
      },
    },
  ],
  waiting: [statusDot, { background: color.Warning.Main }],
  stopping: [statusDot, { background: color.Critical.Main }],
  stopped: [statusDot, { background: color.Critical.Main }],
  finished: [statusDot, { background: color.SurfaceVariant.OnContainer }],
});
