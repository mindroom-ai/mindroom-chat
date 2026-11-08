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
// connection is and offers nothing; its place takes no clicks, so they pass through it to what it
// covers. The place is a grid that centres it and keeps its height (ui/noticeSlots.css.ts).
export const Pill = style([
  noticeMotionFromAbove,
  // After a new version notice in the same place: the pill, which takes no taps, is the one that
  // moves when the other comes or goes.
  { order: 1 },
  // The status icon and its words side by side, centred on each other.
  { display: 'flex', alignItems: 'center', gap: config.space.S200 },
  // At least 32 px high, and never wider than its place: its words wrap there instead.
  {
    minBlockSize: toRem(32),
    maxInlineSize: '100%',
    padding: `${config.space.S100} ${config.space.S300}`,
    borderRadius: config.radii.Pill,
  },
]);

export const PillText = style({ minInlineSize: 0, overflowWrap: 'anywhere' });
