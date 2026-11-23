import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import * as voiceCss from '../voice/VoiceRecordingCapsule.css';

export const Container = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockEnd: config.space.S200,
});

export const Capsule = style([
  voiceCss.Capsule,
  {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: config.space.S100,
  },
]);

export const ControlsRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  inlineSize: '100%',
  minInlineSize: 0,
});

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
  flexShrink: 0,
});
