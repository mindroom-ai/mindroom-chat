import { useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { Text } from 'folds';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import {
  getThreadPrimarySummaryText,
  type ThreadPresentationSnapshot,
} from '../event-store/threads/threadPresentation';
import { replaceMatrixUserIdsWithDisplayNames } from '../event-store/threads/threadMessagePreview';
import { ownDirectionLine } from '../ui/directional';
import * as css from './ThreadContextBanner.css';

const ELLIPSIS = '…';
// Canvas widths can run a pixel under the rendered text; keep the cut clear of the line's own
// ellipsis.
const FIT_SLACK_PX = 2;

/**
 * The longest start of `text` that `fits`, cut after a whole word, without the punctuation before
 * the cut, and ended with an ellipsis. Text that fits comes back whole, and so does text whose
 * first word alone is too wide (or that has no spaces, as Chinese and Japanese), for the line's
 * own ellipsis to cut.
 */
export const fitTextAtWord = (text: string, fits: (candidate: string) => boolean): string => {
  if (fits(text)) return text;
  const words = text.split(' ');
  const cutAfter = (count: number): string | undefined => {
    const start = words
      .slice(0, count)
      .join(' ')
      .replace(/[\s\p{P}]+$/u, '');
    return start ? `${start}${ELLIPSIS}` : undefined;
  };
  let best: string | undefined;
  let low = 1;
  let high = words.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = cutAfter(middle);
    if (candidate && fits(candidate)) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best ?? text;
};

let measuringContext: CanvasRenderingContext2D | null | undefined;
const textWidth = (element: HTMLElement): ((candidate: string) => number) | undefined => {
  measuringContext ??= document.createElement('canvas').getContext('2d');
  const context = measuringContext;
  if (!context) return undefined;
  const style = getComputedStyle(element);
  context.font =
    style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return (candidate) => context.measureText(candidate).width;
};

/**
 * `text` cut at a word so it fits the element's line. The element renders the whole text first,
 * so its width is the room the line has, then the cut; it is cut again when its row changes
 * width.
 */
const useWordFitText = (ref: RefObject<HTMLElement>, text: string): string => {
  const [rowWidthChanges, rowWidthChanged] = useReducer((count: number) => count + 1, 0);
  const [fit, setFit] = useState<{ text: string; rowWidthChanges: number; shown: string }>();
  const fitted = fit?.text === text && fit.rowWidthChanges === rowWidthChanges;

  useLayoutEffect(() => {
    const element = ref.current;
    if (fitted || !element) return;
    // Text the line holds whole stays whole; only an overflowing line is cut.
    const overflows = element.scrollWidth > element.clientWidth;
    const width = overflows ? textWidth(element) : undefined;
    const room = element.clientWidth - FIT_SLACK_PX;
    setFit({
      text,
      rowWidthChanges,
      shown: width ? fitTextAtWord(text, (candidate) => width(candidate) <= room) : text,
    });
  }, [fitted, ref, rowWidthChanges, text]);

  useLayoutEffect(() => {
    // The row is as wide as the banner; the title's own width follows its text.
    const row = ref.current?.parentElement;
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    let rowWidth = row.clientWidth;
    const observer = new ResizeObserver(() => {
      if (row.clientWidth === rowWidth) return;
      rowWidth = row.clientWidth;
      rowWidthChanged();
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [ref]);

  return fitted ? fit.shown : text;
};

/**
 * A thread's title when it has no AI summary: the start of its first message, as plain text with
 * mentions read as names. Undefined when the thread has a summary or its first message no text.
 */
export const getThreadRootTitle = (
  room: Room,
  presentation: Pick<
    ThreadPresentationSnapshot,
    'summaryText' | 'rootPreviewText' | 'rootPreviewLocalization'
  >,
  t: TFunction
): string | undefined => {
  if (presentation.summaryText) return undefined;
  const text = getThreadPrimarySummaryText(presentation, t);
  return text ? replaceMatrixUserIdsWithDisplayNames(room, text) : undefined;
};

/**
 * The banner's title line from the thread's first message, cut at a word to fit one line; a
 * phone's thread bar shows it as large as an AI title.
 */
export function ThreadRootTitle({
  text,
  size = 'T300',
  className,
}: {
  text: string;
  size?: 'T300' | 'H5';
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const shown = useWordFitText(ref, text);
  return (
    <Text
      ref={ref}
      as="span"
      data-thread-context-root-title="true"
      className={className ? `${css.SummaryText} ${className}` : css.SummaryText}
      size={size}
      truncate
      title={text}
      {...ownDirectionLine}
    >
      {shown}
    </Text>
  );
}
