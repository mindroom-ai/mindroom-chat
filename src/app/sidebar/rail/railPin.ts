// The rail pins its top group (Home, Direct Messages, Activity, Threads, Canvases) above the
// spaces when the part left between that group and the foot group still shows enough space
// buttons; with less room the whole top part scrolls as one column again. Two limits keep a
// window resized across the edge from flipping between the two layouts.

/** A pinned rail lets go of its top group once fewer space buttons than this fit below it. */
export const UNPIN_BELOW = 4;

/** An unpinned rail pins its top group again once this many space buttons fit below it. */
export const PIN_FROM = 5;

/**
 * How many whole buttons of `size` px, `gap` px apart, fit in `length` px that start with
 * `inset` px of padding.
 */
export const buttonsThatFit = (
  length: number,
  size: number,
  gap: number,
  inset: number
): number => {
  const pitch = size + gap;
  if (!(pitch > 0)) return 0;
  return Math.max(0, Math.floor((length - inset + gap) / pitch));
};

/** Whether the rail pins its top group, given whether it does now and how many buttons fit. */
export const nextPinned = (pinned: boolean, fit: number): boolean =>
  pinned ? fit >= UNPIN_BELOW : fit >= PIN_FROM;

type Box = Pick<DOMRect, 'top' | 'bottom'>;

/**
 * How far to scroll so that `target` shows whole, `margin` px clear of the visible edges of
 * `view`: negative upward, positive downward, zero when it already does. A target taller than
 * the view lines up with its top.
 */
export const revealDistance = (view: Box, target: Box, margin: number): number => {
  const above = view.top + margin - target.top;
  if (above > 0) return -above;
  const below = target.bottom - (view.bottom - margin);
  return below > 0 ? Math.min(below, -above) : 0;
};
