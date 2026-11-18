import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// A break in the page: a dashed line across the thread with a pill in its middle, as the date
// and unread dividers are a hairline with a label (roomTimelineRows.tsx DividerLabel).

export const TurnBreak = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  alignItems: 'center',
  columnGap: config.space.S200,
  padding: `${config.space.S200} ${config.space.S400}`,
});

export const Line = style({
  borderBlockStart: `1px dashed ${color.SurfaceVariant.ContainerLine}`,
});

export const Pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S200,
  minHeight: toRem(26),
  maxWidth: '100%',
  padding: `0 ${config.space.S300}`,
  borderRadius: config.radii.Pill,
  border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: color.SurfaceVariant.Container,
      borderColor: color.SurfaceVariant.ContainerActive,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '2px',
    },
  },
});

/** The dots on each side of a folded turn's count, which a screen reader skips. */
export const Dots = style({
  letterSpacing: toRem(1),
});
