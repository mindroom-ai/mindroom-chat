import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// One key cap in the help dialog: a rounded square, wider for words such as Ctrl.
export const KeyCap = style({
  direction: 'ltr',
  unicodeBidi: 'isolate',
  display: 'inline-grid',
  placeItems: 'center',
  minInlineSize: toRem(24),
  blockSize: toRem(24),
  paddingInline: toRem(6),
  borderRadius: config.radii.R300,
  boxShadow: `inset 0 0 0 1px ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  font: 'inherit',
  color: color.Surface.OnContainer,
  fontSize: toRem(12),
  lineHeight: 1,
});

// The caps of one shortcut, read in key order also in right-to-left languages.
export const KeyCaps = style({
  direction: 'ltr',
  unicodeBidi: 'isolate',
  display: 'inline-flex',
  gap: 4,
  flexShrink: 0,
});

export const HelpRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S300,
  minHeight: 32,
});

export const HelpScroll = style({
  maxHeight: 'min(70vh, 640px)',
  overflowY: 'auto',
});

// The hints sit over the whole window and never take the pointer.
export const HintLayer = style({
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  pointerEvents: 'none',
});

export const HintBadge = style({
  position: 'absolute',
  direction: 'ltr',
  unicodeBidi: 'isolate',
  transform: 'translate(-50%, -50%)',
  paddingInline: 6,
  paddingBlock: 2,
  borderRadius: config.radii.R300,
  border: `1px solid ${color.Primary.ContainerLine}`,
  background: color.Primary.Container,
  color: color.Primary.OnContainer,
  boxShadow: `0 1px 4px color-mix(in srgb, ${color.Other.Shadow} 40%, transparent)`,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.3,
  whiteSpace: 'nowrap',
});

export const HintChip = style({
  position: 'absolute',
  // At the top: the composer card fills the bottom of the window.
  insetBlockStart: config.space.S200,
  insetInline: 0,
  marginInline: 'auto',
  width: 'fit-content',
  paddingInline: config.space.S300,
  paddingBlock: config.space.S100,
  borderRadius: config.radii.Pill,
  boxShadow: `inset 0 0 0 1px ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  opacity: 0.92,
  color: color.Surface.OnContainer,
  fontSize: toRem(12),
  whiteSpace: 'nowrap',
});
