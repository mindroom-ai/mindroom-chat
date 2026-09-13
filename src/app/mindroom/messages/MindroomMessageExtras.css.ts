import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Extras = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  maxWidth: '100%',
  marginTop: config.space.S200,
});

export const Section = style({
  maxWidth: '100%',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const Summary = style({
  cursor: 'pointer',
  padding: `${config.space.S100} ${config.space.S200}`,
  overflowWrap: 'anywhere',
});

export const Content = style({
  minWidth: 0,
  padding: `0 ${config.space.S200} ${config.space.S200}`,
});

export const PlainText = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  fontFamily: 'monospace',
  fontSize: toRem(13),
  lineHeight: 1.45,
});

export const Markdown = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});
