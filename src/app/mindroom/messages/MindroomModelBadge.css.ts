import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** Small pill under an agent's avatar naming the model that wrote the message. */
export const Badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(3),
  maxWidth: '100%',
  minWidth: 0,
  padding: `0 ${toRem(5)}`,




  backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 92%, transparent)`,
  borderRadius: config.radii.Pill,
  fontWeight: 500,
  lineHeight: toRem(16),
  whiteSpace: 'nowrap',
});

export const Icon = style({
  display: 'block',
  flexShrink: 0,
});

export const Label = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
