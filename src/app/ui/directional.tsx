import React, { forwardRef, type MutableRefObject, type ReactNode, type RefCallback } from 'react';
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
type Placement = { position?: Position; align?: Align };

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

/**
 * Props for a line someone wrote, such as a room name or a thread title: it reads in its own
 * direction but lines up with the interface (index.css), so a long English name in a
 * right-to-left interface loses its end to the ellipsis instead of its start.
 */
export const ownDirectionLine = { dir: 'auto', 'data-own-direction': '' } as const;

/**
 * Props for text someone wrote that may wrap onto more lines, such as a thread card's title: it
 * reads in its own direction and lines up with its own start (index.css), so in a right-to-left
 * interface an English title's second line starts under its first instead of at the other edge.
 */
export const ownDirectionBlock = { dir: 'auto', 'data-own-direction': 'block' } as const;

const LETTER = /\p{L}/u;
const RIGHT_TO_LEFT_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;

/**
 * The direction a text reads in, from its first letter, as `dir="auto"` decides it; undefined
 * when it has no letter. A message body takes it from its plain text, because on the rendered
 * body `dir="auto"` would also count the interface's own labels inside it, such as an agent's
 * tool calls.
 */
export const textDirection = (text: string): 'ltr' | 'rtl' | undefined => {
  for (const char of text) {
    if (LETTER.test(char)) return RIGHT_TO_LEFT_LETTER.test(char) ? 'rtl' : 'ltr';
  }
  return undefined;
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

/** Whether the last press was a touch, with no mouse moved since. */
let touchedLast = false;
let watchingPresses = false;

const watchPresses = () => {
  // Some tests stand in a partial document, without event listeners.
  if (watchingPresses || typeof globalThis.document?.addEventListener !== 'function') return;
  watchingPresses = true;
  const options = { capture: true, passive: true };
  document.addEventListener(
    'pointerdown',
    (event) => {
      touchedLast = event.pointerType === 'touch';
    },
    options
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'mouse') touchedLast = false;
    },
    options
  );
};

/**
 * A tap is no hover, so after one a trigger's mouseenter opens no tooltip. Browsers send one with
 * each tap, and WebKit sends another when the page under the tapped spot changes, such as a menu
 * closing from a hardware keyboard's Escape; nothing would close that tooltip again. A mouse that
 * really moves in sends its pointermove right after the mouseenter (Chromium sends the mouseenter
 * first); without one, a mouseleave cancels the tooltip before its delay runs out.
 */
const skipHoverAfterTouch = (event: Event) => {
  if (!touchedLast) return;
  const trigger = event.currentTarget as Element;
  setTimeout(() => {
    if (touchedLast) trigger.dispatchEvent(new MouseEvent('mouseleave'));
  }, 0);
};

type TriggerRef = RefCallback<HTMLElement | SVGElement>;
// folds hands its children a ref object (typed as a callback); one guarded callback per ref keeps
// React from detaching and attaching it again on every render.
const guardedTriggers = new WeakMap<object, TriggerRef>();

const guardTrigger = (triggerRef: TriggerRef): TriggerRef => {
  // Test doubles of folds may hand over no ref at all.
  if (!triggerRef) return triggerRef;
  let guarded = guardedTriggers.get(triggerRef);
  if (!guarded) {
    guarded = (node) => {
      // Test renderers hand over stand-in nodes without event listeners.
      if (typeof node?.addEventListener === 'function') {
        node.addEventListener('mouseenter', skipHoverAfterTouch);
      }
      if (typeof triggerRef === 'function') triggerRef(node);
      else (triggerRef as MutableRefObject<HTMLElement | SVGElement | null>).current = node;
    };
    guardedTriggers.set(triggerRef, guarded);
  }
  return guarded;
};

type TooltipChildren = (triggerRef: TriggerRef) => ReactNode;

/**
 * folds' TooltipProvider, placed in reading order like {@link PopOut}, which a tap on a touch
 * screen does not open.
 */
export const TooltipProvider = forwardRef<
  HTMLElement,
  Placement & { children: TooltipChildren } & Record<string, unknown>
>(function DirectionalTooltipProvider({ position, align, children, ...props }, ref) {
  watchPresses();
  const placement = mirrorPlacement({ position, align }, documentIsRightToLeft());
  const Base = FoldsTooltipProvider as React.ElementType;
  return (
    <Base {...props} {...placement} ref={ref}>
      {(triggerRef: TriggerRef) => children(guardTrigger(triggerRef))}
    </Base>
  );
}) as unknown as typeof FoldsTooltipProvider;
