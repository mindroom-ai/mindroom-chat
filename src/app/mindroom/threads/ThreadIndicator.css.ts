import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** The "N replies" chip under a message that starts a thread, and the composer's thread label. */











  font: 'inherit',
  textAlign: 'start',






      background: color.SurfaceVariant.ContainerHover,
    },
    'button&:active': {
      background: color.SurfaceVariant.ContainerActive,
    },
  },
});

export const ThreadIndicatorResolved = style({
  borderColor: color.Success.ContainerLine,
  background: color.Success.Container,





  opacity: 0.8,
});

export const ThreadIndicatorLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const ThreadParticipants = style({



});

/** One stacked avatar; each overlaps the previous one. */
export const ThreadParticipant = style({
  width: toRem(18),
  height: toRem(18),
  flexShrink: 0,
  borderRadius: '50%',
  boxShadow: `0 0 0 ${toRem(2)} ${color.SurfaceVariant.Container}`,
  selectors: {
    '& + &': {
      marginLeft: `-${toRem(6)}`,
    },
  },
});

export const ThreadScheduledIndicator = style({





});

export const ThreadScheduledIcon = style({



});

const streamingPulse = keyframes({
  '0%': { opacity: 1, transform: 'scale(1)' },
  '50%': { opacity: 0.35, transform: 'scale(0.8)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
});

/** Pulsing dot of a thread an agent is replying in. */
export const ThreadStreamingDot = style({






  animation: `${streamingPulse} 1.4s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});
