// @vitest-environment jsdom
import { useRef } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TIMELINE_OVERLAY_ATTRIBUTE,
  isKeyboardFocus,
  toolbarOffset,
  useToolbarClearance,
} from './hoverToolbarPlacement';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('isKeyboardFocus', () => {
  it('counts focus the browser shows as keyboard focus', () => {
    expect(isKeyboardFocus({ matches: () => true } as unknown as Element)).toBe(true);
  });

  it('ignores the focus a click leaves on the row', () => {
    expect(isKeyboardFocus({ matches: () => false } as unknown as Element)).toBe(false);
    expect(isKeyboardFocus(null)).toBe(false);
  });

  it('counts the focus where the engine does not know the selector', () => {
    const element = {
      matches: () => {
        throw new SyntaxError('unknown pseudo-class');
      },
    };
    expect(isKeyboardFocus(element as unknown as Element)).toBe(true);
  });
});

type Rect = { top: number; bottom: number; left: number; right: number };
const rectOf = ({ top, bottom, left, right }: Rect) =>
  ({
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  } as DOMRect);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.restoreAllMocks();
});

/**
 * A scroller whose visible rows start at y=100 (its scroll padding), with an `[+all]`-like
 * control from y=110 to 130 at the right, and a row at `rowTop` whose toolbar normally sits 30 px
 * above it at the right edge. With `senderRight`, the row has a sender line from 4 to 26 px into it,
 * from x=60 to `senderRight`. With `codeActionsAt`, the row holds a code block whose buttons
 * span 24 px from that far into it, from x=900 to 980; `actionsAttribute` marks them as another
 * kind of content's buttons instead, such as a file card's.
 */
const renderRow = (
  rowTop: number,
  overlayLeft = 900,
  senderRight?: number,
  codeActionsAt?: number,
  actionsAttribute = 'data-code-block-actions'
) => {
  const seen: Array<number | undefined> = [];
  function Row() {
    const rowRef = useRef<HTMLDivElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const clearance = useToolbarClearance(rowRef, toolbarRef, true);
    seen.push(clearance);
    return (
      <div data-testid="scroller" style={{ overflowY: 'auto', scrollPaddingTop: '100px' }}>
        <div {...{ [TIMELINE_OVERLAY_ATTRIBUTE]: '' }} data-testid="overlay" />
        <div ref={rowRef} data-testid="row">
          <div ref={toolbarRef} data-testid="toolbar" />
          {senderRight !== undefined && <div data-message-sender-line="" data-testid="sender" />}
          {codeActionsAt !== undefined && (
            <div {...{ [actionsAttribute]: '' }} data-testid="code" />
          )}
        </div>
      </div>
    );
  }
  const codeTop = rowTop + (codeActionsAt ?? 0);
  const rects: Record<string, Rect> = {
    scroller: { top: 0, bottom: 800, left: 0, right: 1000 },
    overlay: { top: 110, bottom: 130, left: overlayLeft, right: overlayLeft + 50 },
    row: { top: rowTop, bottom: rowTop + 80, left: 0, right: 1000 },
    toolbar: { top: rowTop - 30, bottom: rowTop + 6, left: 850, right: 1000 },
    sender: { top: rowTop + 4, bottom: rowTop + 26, left: 60, right: senderRight ?? 0 },
    code: { top: codeTop, bottom: codeTop + 24, left: 900, right: 980 },
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement
  ) {
    return rectOf(rects[this.dataset.testid ?? ''] ?? { top: 0, bottom: 0, left: 0, right: 0 });
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = computed(element);
    if ((element as HTMLElement).dataset?.testid !== 'scroller') return style;
    return { ...style, overflowY: 'auto', scrollPaddingTop: '100px' } as CSSStyleDeclaration;
  });
  host = document.createElement('div');
  document.body.append(host);
  act(() => {
    root = createRoot(host!);
    root.render(<Row />);
  });
  return seen.at(-1);
};

describe('useToolbarClearance', () => {
  it('keeps the usual place above a row with room above it', () => {
    expect(renderRow(400)).toBeUndefined();
  });

  it('moves the toolbar of the row right under the [+all] toggle below the toggle', () => {
    // The toggle ends at 130, plus an 8 px gap; the row starts at 140.
    expect(renderRow(140)).toBe(-2);
  });

  it('moves the toolbar of the row under the [+all] toggle below its sender line too', () => {
    // The sender line ends at 166, plus an 8 px gap; the row starts at 140.
    expect(renderRow(140, 900, 1000)).toBe(34);
    // A sender line that ends before the toolbar's span starts, as in Compact, is no reason.
    expect(renderRow(140, 900, 800)).toBe(-2);
  });

  it('stays over the sender line where the buttons of a code block are further down', () => {
    // Below the sender line (34) it would cover the code block's buttons at 46 to 70, so it stays
    // below the toggle, over the sender line.
    expect(renderRow(140, 900, 1000, 46)).toBe(-2);
    // Buttons right under the sender line, with no room below them in the 80 px row, do not push
    // it up under the toggle either.
    expect(renderRow(140, 900, 1000, 30)).toBe(-2);
    // Buttons further down leave it below the sender line.
    expect(renderRow(140, 900, 1000, 80)).toBe(34);
  });

  it('moves below the buttons of a code block at the top of a row without a sender line', () => {
    // Below the toggle (-2) it would cover the buttons at 4 to 28; it goes 8 px below them.
    expect(renderRow(140, 900, undefined, 4)).toBe(36);
    // Buttons it is clear of leave it below the toggle.
    expect(renderRow(140, 900, undefined, 48)).toBe(-2);
    // In its usual place above the row it stays, also over buttons at the row's top.
    expect(renderRow(400, 900, undefined, 4)).toBeUndefined();
  });

  it('stays over the sender line where the buttons of a file card are under it', () => {
    // A file card right under the sender line has its View and Download buttons at its end.
    expect(renderRow(140, 900, 1000, 46, 'data-file-actions')).toBe(-2);
  });

  it('places the toolbar again when the sender line changes size', () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(element: Element) {
          observed.push(element);
        }

        disconnect() {}
      }
    );
    renderRow(140, 900, 1000);
    vi.unstubAllGlobals();
    expect(observed.map((element) => (element as HTMLElement).dataset.testid)).toEqual([
      'row',
      'sender',
    ]);
  });

  it('moves the toolbar of a row under the sticky header into the visible part of the row', () => {
    // No overlay over the toolbar; the visible rows start at 100.
    expect(renderRow(90, 100)).toBe(10);
  });
});

describe('toolbarOffset', () => {
  it('goes below two button groups only to a spot clear of both', () => {
    const groups = [
      { top: 4, bottom: 28 },
      { top: 64, bottom: 88 },
    ];
    // Below the first group (36) it would cover the second, and below the second (96) it would
    // reach past the 120 px row: it stays.
    expect(toolbarOffset(-36, 0, 120, 42, [], undefined, groups)).toBe(0);
    // In a taller row it goes below both.
    expect(toolbarOffset(-36, 0, 400, 42, [], undefined, groups)).toBe(96);
  });

  it('goes to the nearest clear spot below the buttons, never up', () => {
    // Below the first group (36) is clear of the second, at 100.
    const apart = [
      { top: 4, bottom: 28 },
      { top: 100, bottom: 124 },
    ];
    expect(toolbarOffset(-36, 0, 400, 42, [], undefined, apart)).toBe(36);
    // Below a group above the toolbar (-68) would be back under the header.
    const above = [
      { top: -100, bottom: -76 },
      { top: 20, bottom: 44 },
    ];
    expect(toolbarOffset(-36, 0, 400, 42, [], undefined, above)).toBe(52);
  });

  it('stays below what floats over the timeline in a row too short to go below the buttons', () => {
    // A file card's buttons from 18 to 50 px in a 68 px row without a sender line.
    expect(toolbarOffset(-36, 10, 68, 42, [], undefined, [{ top: 18, bottom: 50 }])).toBe(10);
  });

  // A 42 px toolbar that usually sits 36 px above a 60 px row.
  const place = (covered: number, folds: Parameters<typeof toolbarOffset>[4] = []) =>
    toolbarOffset(-36, covered, 60, 42, folds);

  it('keeps the usual place when nothing is in the way', () => {
    expect(place(-200)).toBeUndefined();
    // A fold button far above the toolbar is no reason to move.
    expect(place(-200, [{ top: -120, bottom: -88, ownRow: false }])).toBeUndefined();
  });

  it('moves below the Show less button of the long message above, 8 px clear of it', () => {
    expect(place(-200, [{ top: -46, bottom: -14, ownRow: false }])).toBe(-6);
  });

  it('moves above the fold button of its own row when that row is scrolled under the header', () => {
    // The header ends 40 px into the row, which pins the toolbar 4 px above the row's bottom,
    // onto the row's own button; it goes up, 8 px clear of that button, instead.
    expect(place(40)).toBe(14);
    expect(place(40, [{ top: 20, bottom: 52, ownRow: true }])).toBe(-30);
  });

  describe('with the sender line of its row from 4 to 26 px', () => {
    const sender = { top: 4, bottom: 26 };
    const placeWithSender = (covered: number, folds: Parameters<typeof toolbarOffset>[4] = []) =>
      toolbarOffset(-36, covered, 60, 42, folds, sender);

    it('keeps the usual place, which ends just inside the row', () => {
      expect(placeWithSender(-200)).toBeUndefined();
    });

    it('moves below the sender line when the fold button of the message above pushes it down', () => {
      // Under Show less it would cover the end of the sender line, with the time and the reply
      // details button; it goes 8 px below the line instead.
      expect(placeWithSender(-200, [{ top: -46, bottom: -14, ownRow: false }])).toBe(34);
    });

    it('moves below the sender line when what floats over the timeline pushes it down', () => {
      expect(placeWithSender(10)).toBe(34);
    });

    it('ignores a sender line hidden under the header', () => {
      expect(placeWithSender(40)).toBe(14);
    });

    it('moves below the buttons right under the sender line where it would cover them', () => {
      // Over the sender line it would reach the buttons at 30 to 54; it goes 8 px below them.
      expect(toolbarOffset(-36, 0, 400, 42, [], sender, [{ top: 30, bottom: 54 }])).toBe(62);
    });

    it('stays over the sender line where there is no room below the buttons under it', () => {
      // A file card's View and Download buttons from 42 to 74 px in a 92 px row: below them the
      // 42 px toolbar would reach into the next row.
      expect(toolbarOffset(-36, 0, 92, 42, [], sender, [{ top: 42, bottom: 74 }])).toBe(0);
    });

    // The fold button of the long message above, and the row's own Show less, which sticks to
    // the bottom of the view, here 60 px into the row.
    const foldAboveAndOwn = [
      { top: -46, bottom: -14, ownRow: false },
      { top: 60, bottom: 92, ownRow: true },
    ];

    it('stays under the fold button above when below the buttons is its own Show less', () => {
      const actions = [{ top: 30, bottom: 54 }];
      expect(toolbarOffset(-36, -200, 400, 42, foldAboveAndOwn, sender, actions)).toBe(-6);
    });

    it('stays under the fold button above when its own Show less is below the sender line', () => {
      // Below the sender line it would cover its own Show less.
      expect(toolbarOffset(-36, -200, 400, 42, foldAboveAndOwn, sender)).toBe(-6);
    });
  });
});
