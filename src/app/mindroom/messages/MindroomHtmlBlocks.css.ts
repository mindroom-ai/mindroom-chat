import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** A collapsible block inside a message body (tool call, reasoning, attachment preview). */
export const Block = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  maxWidth: '100%',
  margin: `${config.space.S100} 0`,




  overflow: 'hidden',
});

export const BlockHeader = style({
  display: 'flex',








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










  lineHeight: toRem(22),
  verticalAlign: 'middle',
  userSelect: 'none',
});

export const PasteMarkerBadgeMeta = style({



  minWidth: 0,
  opacity: 0.7,
});
