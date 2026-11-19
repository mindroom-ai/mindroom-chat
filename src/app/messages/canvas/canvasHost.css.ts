import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const Error = style({
  color: color.Critical.Main,
});

export const Notice = style({
  alignItems: 'center',
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flex: '0 0 auto',
  gap: config.space.S200,
  justifyContent: 'space-between',
  padding: `${config.space.S200} ${config.space.S300}`,
});

export const Staged = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  width: '100%',
});

export const Data = style({
  fontFamily: 'monospace',
  fontSize: '0.75rem',
  maxHeight: '10rem',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});
