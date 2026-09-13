import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset } from 'folds';

const BlockSpacing = style({
  marginBottom: config.space.S200,
  marginTop: config.space.S200,
  selectors: {
    '&:first-child': {
      marginTop: 0,
    },
    '&:last-child': {
      marginBottom: 0,
    },
  },
});

const BaseCode = style({
  color: color.SurfaceVariant.OnContainer,
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
});

const CodeFont = style({
  fontFamily: 'var(--font-mono)',
});

export const Block = style([
  DefaultReset,
  BlockSpacing,
  {
    borderRadius: config.radii.R300,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    backgroundColor: color.SurfaceVariant.Container,
    overflow: 'hidden',
  },
]);

export const BlockHeader = style([
  DefaultReset,
  {
    width: '100%',
    border: 'none',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: config.space.S200,
    padding: `${config.space.S200} ${config.space.S300}`,
    cursor: 'pointer',
    color: color.SurfaceVariant.OnContainer,
    textAlign: 'left',
  },
]);

export const BlockHeaderMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
});

export const BlockBody = style({
  borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: `${config.space.S200} ${config.space.S300}`,
});

export const BlockInlineResult = style({
  color: color.SurfaceVariant.OnContainer,
  marginLeft: config.space.S200,
});

export const BlockResult = style([
  BaseCode,
  CodeFont,
  {
    marginTop: config.space.S200,
    whiteSpace: 'pre-wrap',
    padding: `${config.space.S100} ${config.space.S200}`,
  },
]);

export const ToolGroupList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});

export const ToolGroupItem = style([
  BaseCode,
  {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: config.space.S100,
    padding: `${config.space.S100} ${config.space.S200}`,
  },
]);

export const PasteMarkerBadge = style([
  DefaultReset,
  BaseCode,
  {
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: '100%',
    gap: config.space.S100,
    verticalAlign: 'middle',
    padding: `0 ${config.space.S100}`,
    lineHeight: 1.6,
  },
]);

export const PasteMarkerBadgeMeta = style({
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  gap: config.space.S100,
  color: color.SurfaceVariant.OnContainer,
});
