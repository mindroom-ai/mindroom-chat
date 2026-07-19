import { describe, expect, it } from 'vitest';
import {
  captureTimelineBulkExpansionAnchor,
  restoreTimelineBulkExpansionAnchor,
} from './useTimelineBulkExpansionAnchor';

type FakeMessage = {
  dataset: { messageId: string };
  getBoundingClientRect: () => DOMRect;
};

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    height: bottom - top,
  } as DOMRect);

const makeScroller = ({
  clientHeight = 800,
  messages = [],
  scrollHeight = 5_000,
  scrollTop = 2_000,
}: {
  clientHeight?: number;
  messages?: FakeMessage[];
  scrollHeight?: number;
  scrollTop?: number;
} = {}): HTMLDivElement =>
  ({
    clientHeight,
    scrollHeight,
    scrollTop,
    getBoundingClientRect: () => rect(100, 900),
    querySelectorAll: () => messages,
  } as unknown as HTMLDivElement);

describe('timeline bulk expansion anchor', () => {
  it('restores the same fully visible message after rows above it grow', () => {
    let anchorTop = 430;
    const scroller = makeScroller({
      messages: [
        {
          dataset: { messageId: '$above' },
          getBoundingClientRect: () => rect(140, 240),
        },
        {
          dataset: { messageId: '$anchor' },
          getBoundingClientRect: () => rect(anchorTop, anchorTop + 120),
        },
      ],
    });

    const anchor = captureTimelineBulkExpansionAnchor(scroller, 1);
    expect(anchor).toEqual({
      kind: 'message',
      generation: 1,
      messageId: '$anchor',
      top: 430,
    });

    anchorTop += 785;
    restoreTimelineBulkExpansionAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(2_785);
  });

  it('keeps a reader at the latest message when the baseline changes at the bottom', () => {
    const scroller = makeScroller({
      clientHeight: 800,
      scrollHeight: 5_000,
      scrollTop: 4_190,
    });
    const anchor = captureTimelineBulkExpansionAnchor(scroller, 2);
    expect(anchor).toEqual({ kind: 'bottom', generation: 2 });

    Object.defineProperty(scroller, 'scrollHeight', { value: 8_000 });
    restoreTimelineBulkExpansionAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(7_200);
  });
});
