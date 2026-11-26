import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Preview = style({
  inlineSize: '100%',
  minInlineSize: 0,
  maxBlockSize: toRem(64),
  overflowY: 'auto',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
  color: color.SurfaceVariant.OnContainer,
  paddingInline: config.space.S100,
  paddingBlockStart: config.space.S100,
  paddingBlockEnd: config.space.S200,
  borderBlockEnd: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.SurfaceVariant.ContainerLine} 60%, transparent)`,
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
  minInlineSize: 0,
  maxInlineSize: '100%',
});

// Locks every recovery button (Primary solid, Secondary with icon, Secondary text-only, Critical)
// to identical 32px border-box height so solid vs outlined and icon vs text-only stay pixel-aligned.
export const RecoveryButton = style({
  selectors: {
    '&&': {
      blockSize: toRem(32),
      minBlockSize: toRem(32),
      maxBlockSize: toRem(32),
      boxSizing: 'border-box',
      whiteSpace: 'nowrap',
    },
  },
});
