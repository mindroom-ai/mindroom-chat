/**
 * Where the live transcript sits in the floating window: under the stage, beside it (at the end
 * side), or only its latest line over the bottom of the stage while the window is too short for
 * more.
 */
export type TranscriptLayout = 'stacked' | 'side' | 'subtitle';

/** The window is at least this wide (px) for the transcript to sit beside the stage. */
export const SIDE_MIN_WIDTH = 560;
/** Below this height (px) every window shows the subtitle. */
export const TRANSCRIPT_MIN_HEIGHT = 240;
/** Below this height (px) a window too narrow for the side layout shows the subtitle. */
export const STACKED_MIN_HEIGHT = 340;

/** The stage's share of the window body, beside the transcript: from a quarter to four fifths. */
export const MIN_TRANSCRIPT_SPLIT = 0.25;
export const MAX_TRANSCRIPT_SPLIT = 0.8;
export const DEFAULT_TRANSCRIPT_SPLIT = 0.6;
/** One arrow key moves the divider by this share. */
const SPLIT_STEP = 0.05;

export const transcriptLayout = (size: { width: number; height: number }): TranscriptLayout => {
  const { width, height } = size;
  const wide = width >= SIDE_MIN_WIDTH;
  if (height < TRANSCRIPT_MIN_HEIGHT || (height < STACKED_MIN_HEIGHT && !wide)) return 'subtitle';
  return wide ? 'side' : 'stacked';
};

/** Within the bounds, in whole percent, so steps of 5 add up without rounding errors. */
export const clampSplit = (split: number): number => {
  if (!Number.isFinite(split)) return DEFAULT_TRANSCRIPT_SPLIT;
  const percent = Math.round(split * 100) / 100;
  return Math.min(MAX_TRANSCRIPT_SPLIT, Math.max(MIN_TRANSCRIPT_SPLIT, percent));
};

/** Whether a stored split is one the divider could have set. */
export const isTranscriptSplit = (value: unknown): value is number =>
  typeof value === 'number' && value >= MIN_TRANSCRIPT_SPLIT && value <= MAX_TRANSCRIPT_SPLIT;

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'width' | 'height'>;

/**
 * The stage's share when the divider is dragged to the pointer: measured from the top of a
 * stacked layout, and from the start side (the right one in right-to-left languages) of a
 * side-by-side one.
 */
export const splitFromPointer = (
  layout: TranscriptLayout,
  box: Box,
  x: number,
  y: number,
  rtl: boolean
): number => {
  if (layout === 'stacked') return clampSplit((y - box.top) / box.height);
  return clampSplit((rtl ? box.right - x : x - box.left) / box.width);
};

/**
 * The split after a key on the focused divider: its arrows move it 5 percent the way they point
 * (Up and Down under the stage, Left and Right beside it), Home and End to the ends. Undefined for
 * any other key, which the divider leaves alone.
 */
export const stepSplit = (
  split: number,
  key: string,
  layout: TranscriptLayout,
  rtl: boolean
): number | undefined => {
  if (key === 'Home') return MIN_TRANSCRIPT_SPLIT;
  if (key === 'End') return MAX_TRANSCRIPT_SPLIT;
  const grows = layout === 'stacked' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
  const shrinks = layout === 'stacked' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === grows) return clampSplit(split + SPLIT_STEP);
  if (key === shrinks) return clampSplit(split - SPLIT_STEP);
  return undefined;
};
