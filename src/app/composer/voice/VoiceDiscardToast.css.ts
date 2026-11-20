import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';
import { noticeMotionFromAbove } from '../../ui/noticeMotion.css';

// A one-line pill in the page's notice place (ui/noticeSlots.tsx): what was discarded, and Undo.
export const Toast = style({
  ...noticeMotionFromAbove,
  // A phone's place has no height of its own: the pill keeps the height of its content.
  flexShrink: 0,
  minBlockSize: toRem(40),
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'center',
  gap: config.space.S300,
  maxInlineSize: '100%',
  paddingBlock: config.space.S100,
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S100,
  borderRadius: config.radii.Pill,
  // The place passes clicks through; the pill takes its own.
  pointerEvents: 'auto',
});
