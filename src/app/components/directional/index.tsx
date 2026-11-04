import React, { forwardRef } from 'react';
import {
  PopOut as FoldsPopOut,
  TooltipProvider as FoldsTooltipProvider,
  type Align,
  type Position,
} from 'folds';

/**
 * Where a pop-out or tooltip goes relative to its anchor, in folds' terms: `position` is the
 * anchor's side it opens on, and `align` the end of that side it lines up with.
 */
export type Placement = { position?: Position; align?: Align };

const otherSide: Partial<Record<Position, Position>> = { Left: 'Right', Right: 'Left' };
const otherEnd: Partial<Record<Align, Align>> = { Start: 'End', End: 'Start' };

/**
 * folds reads placements as physical sides: Left and Right, and along the top or bottom of the
 * anchor Start is its left end and End its right one. The app means them in reading order, so
 * in a right-to-left document they mirror: Left and Right trade places, and so do Start and End
 * along the top or bottom. Beside the anchor (Left or Right) Start stays the top.
 */
export const mirrorPlacement = (
  { position, align }: Placement,
  rightToLeft: boolean
): Placement => {
  if (!rightToLeft) return { position, align };
  const side = (position && otherSide[position]) ?? position;
  const beside = side === 'Left' || side === 'Right';
  return { position: side, align: !beside && align ? otherEnd[align] ?? align : align };
};

/** Whether the document reads right to left; i18n.ts sets `dir` with the language. */
export const documentIsRightToLeft = (): boolean =>
  // Some tests stand in a partial document, without an element or one without methods.
  globalThis.document?.documentElement?.dir === 'rtl';

/** folds' PopOut, placed in reading order: `position="Right"` opens toward the line's end. */
export const PopOut = forwardRef<HTMLElement, Placement & Record<string, unknown>>(
  function DirectionalPopOut({ position, align, ...props }, ref) {
    const placement = mirrorPlacement({ position, align }, documentIsRightToLeft());
    const Base = FoldsPopOut as React.ElementType;
    return <Base {...props} {...placement} ref={ref} />;
  }
) as unknown as typeof FoldsPopOut;

/** folds' TooltipProvider, placed in reading order like {@link PopOut}. */
export const TooltipProvider = forwardRef<HTMLElement, Placement & Record<string, unknown>>(
  function DirectionalTooltipProvider({ position, align, ...props }, ref) {
    const placement = mirrorPlacement({ position, align }, documentIsRightToLeft());
    const Base = FoldsTooltipProvider as React.ElementType;
    return <Base {...props} {...placement} ref={ref} />;
  }
) as unknown as typeof FoldsTooltipProvider;
