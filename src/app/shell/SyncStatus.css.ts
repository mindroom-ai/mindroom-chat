import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';
import { noticeMotionFromAbove } from '../ui/noticeMotion.css';

// What is read out: in the status region, where nothing makes it inert, and out of sight; the
// pill shows the same words.
export const Announcement = style({
  position: 'absolute',
  inlineSize: 1,
  blockSize: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
});

// A one-line pill in the page's notice place, under a new version notice there. It says how the
// connection is and offers nothing, so clicks pass through it to what it covers.
export const Pill = style({
  ...noticeMotionFromAbove,
  // Below a new version notice in the same place: the pill, which takes no taps, is the one that
  // moves when the other comes or goes.
  order: 1,
  // A phone's place has no height of its own: the pill keeps the height of its text, also wrapped.
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S200,
  alignSelf: 'center',
  maxInlineSize: '100%',
  minBlockSize: toRem(32),
  paddingBlock: config.space.S100,
  paddingInline: config.space.S300,
  borderRadius: config.radii.Pill,
  pointerEvents: 'none',
});

export const PillText = style({ minInlineSize: 0, overflowWrap: 'anywhere' });
