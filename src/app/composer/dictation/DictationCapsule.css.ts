import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const Container = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockEnd: config.space.S200,
});

export const StatusNote = style({
  paddingInline: config.space.S200,
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.85,
});

export const RecoveryBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  width: '100%',
  minWidth: 0,
});

export const ErrorText = style({
  flex: '1 1 12rem',
  minWidth: 0,
  color: color.Critical.Main,
  overflowWrap: 'anywhere',
});

export const RecoveryActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
  flexShrink: 0,
});
