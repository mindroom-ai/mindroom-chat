import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** Items in a row, centered on the text line. */
const inlineRow = { display: 'inline-flex', alignItems: 'center' } as const;

/** The "N replies" chip under a message that starts a thread, and the composer's thread label. */
export const ThreadIndicator = style({
  ...inlineRow,
  alignSelf: 'flex-start',
  gap: config.space.S100,
  minWidth: 0,
  maxWidth: '100%',
  padding: `${toRem(2)} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: `solid ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  textAlign: 'start',
  selectors: {
    'button&': { cursor: 'pointer' },
    'button&:hover, button&:focus-visible': {
      background: color.SurfaceVariant.ContainerHover,
    },
    'button&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
    'button&:active': {
      background: color.SurfaceVariant.ContainerActive,
    },
  },
});

/** A resolved thread's chip takes the success tint and steps back a little. */
export const ThreadIndicatorResolved = style({
  borderColor: color.Success.ContainerLine,
  background: color.Success.Container,
  color: color.Success.OnContainer,
  selectors: {
    'button&:hover, button&:focus-visible': {
      background: color.Success.ContainerHover,
    },
  },
  opacity: 0.9,
});

export const ThreadIndicatorLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const ThreadParticipants = style({
  ...inlineRow,
  paddingInlineStart: toRem(2),
});

// Each face overlaps the one before it by this much.
const participantOverlap = `-${toRem(6)}`;

/** One stacked avatar; each overlaps the previous one. */
export const ThreadParticipant = style({
  width: toRem(18),
  height: toRem(18),
  flexShrink: 0,
  borderRadius: '50%',
  boxShadow: `0 0 0 ${toRem(2)} ${color.SurfaceVariant.Container}`,
  selectors: {
    '& + &': {
      marginLeft: participantOverlap,
    },
    // On a Compact thread bar the faces are a full 24 px tile whose outer pixel is a hairline
    // ring in the surface color, so the overlap reads as a cut-out rather than a shadow.
    '[data-compact-card-metadata] &': {
      boxSizing: 'border-box',
      width: toRem(24),
      height: toRem(24),
      border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.Container}`,
      boxShadow: 'none',
    },
  },
});

/** "Scheduled" label of a thread with pending scheduled tasks, beside its stats. */
export const ThreadScheduledIndicator = style({
  minWidth: 0,
  maxWidth: toRem(180),
  overflow: 'hidden',
  color: color.Secondary.Main,
});

export const ThreadScheduledIcon = style({
  flexShrink: 0,
  display: 'block',
  color: 'currentColor',
});

const streamingPulse = keyframes({
  '0%': { opacity: 1, transform: 'scale(1)' },
  '50%': { opacity: 0.35, transform: 'scale(0.8)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
});

/** Pulsing dot of a thread an agent is replying in. */
export const ThreadStreamingDot = style({
  display: 'inline-block',
  flexShrink: 0,
  width: toRem(6),
  height: toRem(6),
  borderRadius: '50%',
  backgroundColor: color.Success.Main,
  animation: `${streamingPulse} 1.4s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});
