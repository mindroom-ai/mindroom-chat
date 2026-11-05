import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** A collapsible block inside a message body (tool call, reasoning, attachment preview). */
export const Block = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  maxWidth: '100%',
  margin: `${config.space.S100} 0`,
  // A quiet box: the surface tint at half strength inside a hairline edge.
  color: color.SurfaceVariant.OnContainer,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 50%, transparent)`,
  borderRadius: config.radii.R400,
  overflow: 'hidden',
});

export const BlockHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  width: '100%',
  minHeight: toRem(32),
  padding: `${config.space.S100} ${config.space.S200}`,
  color: 'inherit',
  background: 'none',
  border: 'none',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible': {
      background: color.SurfaceVariant.ContainerHover,
    },
  },
});

export const BlockHeaderMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

export const BlockChevron = style({
  flexShrink: 0,
  opacity: 0.7,
});

export const BlockBody = style({
  minWidth: 0,
  padding: `${config.space.S100} ${config.space.S200} ${config.space.S200}`,
  borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  overflowX: 'auto',
});

/** Inline chip standing in for a pasted-text attachment marker. */
export const PasteMarkerBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: '0.375rem',
  maxWidth: '100%',
  minWidth: 0,
  paddingInline: config.space.S200,
  color: color.SurfaceVariant.OnContainer,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 70%, transparent)`,
  borderRadius: config.radii.Pill,
  lineHeight: toRem(22),
  verticalAlign: 'middle',
  userSelect: 'none',
});

export const PasteMarkerBadgeMeta = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: '0.25rem',
  minWidth: 0,
  opacity: 0.7,
});
