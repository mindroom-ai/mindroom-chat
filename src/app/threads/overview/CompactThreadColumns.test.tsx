// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPACT_COLLAPSED_RAIL_WIDTH_PX,
  COMPACT_COLUMNS_MIN_WIDTH_PX,
  COMPACT_COLUMN_GAP_PX,
  COMPACT_COLUMN_INITIAL_CARDS,
  getVisibleColumnCardIds,
  mergeVisibleSectionOrder,
} from './compactColumnsLayout';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { CompactThreadColumns } from './CompactThreadColumns';
import { useCompactColumnsBoard } from './useCompactColumnsBoard';
import { COLUMN_FLIP_DURATION_MS } from './useCompactColumnMotion';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count !== undefined ? `${key}:${String(params.count)}` : key,
  }),
}));

vi.mock('../ThreadStreamingDot', () => ({
  ThreadStreamingDot: () => <span data-streaming-dot="true" />,
}));

vi.mock('./CompactCardSwipe', () => ({
  useCompactCardSwipeList: () => undefined,
}));

const SECTIONS: CompactThreadSection[] = [
  { id: 'needsYou', rootIds: ['$alpha', '$beta'] },
  { id: 'working', rootIds: ['$gamma'] },
  { id: 'done', rootIds: ['$delta'] },
];

const stubMatchMedia = (reducedMotion: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const makeRect = (left: number, width: number, height = 400): DOMRect => ({
  x: left,
  y: 0,
  left,
  top: 0,
  width,
  height,
  right: left + width,
  bottom: height,
  toJSON: () => ({}),
});

/** Computes dynamic column rects from current DOM order and collapsed state (LTR or RTL). */
const bindDynamicColumnRects = (container: HTMLElement) => {
  const board = container.querySelector<HTMLElement>('[data-compact-columns-board]')!;
  vi.spyOn(board, 'getBoundingClientRect').mockImplementation(() => makeRect(0, 1000, 400));
  const computeRect = (col: HTMLElement): DOMRect => {
    const columns = Array.from(board.querySelectorAll<HTMLElement>('[data-compact-column]'));
    const rtl = getComputedStyle(board).direction === 'rtl';
    let cursor = rtl ? 1000 : 0;
    for (const item of columns) {
      const width =
        item.getAttribute('data-collapsed') === 'true' ? COMPACT_COLLAPSED_RAIL_WIDTH_PX : 320;
      const left = rtl ? cursor - width : cursor;
      if (item === col) return makeRect(left, width);
      cursor = rtl ? left - COMPACT_COLUMN_GAP_PX : left + width + COMPACT_COLUMN_GAP_PX;
    }
    return makeRect(0, 0);
  };
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this === board) return makeRect(0, 1000, 400);
    const col = this.closest<HTMLElement>('[data-compact-column]');
    if (col && board.contains(col)) return computeRect(col);
    return makeRect(0, 0);
  });
};

const columnOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-compact-column]')).map(
    (el) => el.dataset.compactColumn ?? ''
  );

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const createTouch = (target: EventTarget, clientX: number, clientY: number) =>
  ({ identifier: 1, target, clientX, clientY, pageX: clientX, pageY: clientY }) as Touch;

const touchEvent = (type: string, target: EventTarget, clientX: number, clientY: number) => {
  const touch = createTouch(target, clientX, clientY);
  const touches = type === 'touchend' || type === 'touchcancel' ? [] : [touch];
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches,
    changedTouches: [touch],
    targetTouches: touches,
  });
};

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compactColumnsLayout helpers', () => {
  it('derives the structural width threshold and merges hidden empty buckets when reordering', () => {
    expect(COMPACT_COLUMNS_MIN_WIDTH_PX).toBe(824);
    expect(
      mergeVisibleSectionOrder(
        ['needsYou', 'working', 'later', 'quiet', 'done'],
        ['done', 'needsYou', 'working']
      )
    ).toEqual(['done', 'needsYou', 'later', 'quiet', 'working']);
  });
});

describe('CompactThreadColumns', () => {
  it('renders open columns and 90° collapsed rails with streaming/unread signals, zero cards in collapsed columns, and open-count tracking', () => {
    const onToggleFold = vi.fn();
    const { container, rerender } = render(
      <CompactThreadColumns
        sections={SECTIONS}
        folded={['done']}
        getSignal={(section) =>
          section.id === 'working'
            ? { streaming: true }
            : section.id === 'needsYou'
              ? { unread: true }
              : undefined
        }
        onToggleFold={onToggleFold}
        onReorder={vi.fn()}
        renderCard={(id) => (
          <div key={id} data-test-card={id}>
            {id}
          </div>
        )}
      />
    );

    const board = container.querySelector('[data-compact-columns-board="true"]');
    expect(board?.getAttribute('data-open-count')).toBe('2');
    expect(columnOrder(container)).toEqual(['needsYou', 'working', 'done']);
    expect(
      container
        .querySelector('[data-compact-column-header="needsYou"]')
        ?.getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      container.querySelector('[data-compact-column-rail="done"]')?.getAttribute('aria-expanded')
    ).toBe('false');
    expect(container.querySelector('[data-test-card="$alpha"]')).toBeTruthy();
    expect(container.querySelector('[data-test-card="$delta"]')).toBeNull();
    expect(
      container.querySelector('[data-compact-column="working"] [data-streaming-dot="true"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-compact-column="needsYou"] [data-column-unread-dot="true"]')
    ).toBeTruthy();

    rerender(
      <CompactThreadColumns
        sections={SECTIONS}
        folded={['working', 'done']}
        getSignal={(section) => (section.id === 'working' ? { streaming: true } : undefined)}
        onToggleFold={onToggleFold}
        onReorder={vi.fn()}
        renderCard={(id) => (
          <div key={id} data-test-card={id}>
            {id}
          </div>
        )}
      />
    );
    expect(board?.getAttribute('data-open-count')).toBe('1');
    expect(
      container.querySelector('[data-compact-column-rail="working"] [data-streaming-dot="true"]')
    ).toBeTruthy();

    fireEvent.click(container.querySelector('[data-compact-column-rail="done"]')!);
    expect(onToggleFold).toHaveBeenCalledWith('done');
  });

  it('caps each open column at 40 initial cards and reveals more via button, IntersectionObserver, and End key', () => {
    const manyIds = Array.from({ length: 95 }, (_, index) => `$item-${index}`);
    const bigSections: CompactThreadSection[] = [
      { id: 'needsYou', rootIds: manyIds },
      { id: 'done', rootIds: ['$done-0'] },
    ];
    expect(getVisibleColumnCardIds(bigSections, ['done'])).toHaveLength(
      COMPACT_COLUMN_INITIAL_CARDS
    );

    let ioCallback: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          ioCallback = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );

    function ControlledBoard() {
      const viewRef = useRef<HTMLDivElement>(null);
      const board = useCompactColumnsBoard({
        viewRef,
        scopeKey: '!room:test',
        sections: bigSections,
        folded: ['done'],
      });
      return (
        <div ref={viewRef} data-compact-room-view="true">
          <CompactThreadColumns
            sections={bigSections}
            folded={['done']}
            columnLimits={board.limits}
            onShowMore={board.showMore}
            onToggleFold={vi.fn()}
            onReorder={vi.fn()}
            renderCard={(id) => (
              <button key={id} type="button" data-test-card={id} data-thread-root-id={id}>
                {id}
              </button>
            )}
          />
        </div>
      );
    }

    const { container, unmount } = render(<ControlledBoard />);
    expect(container.querySelectorAll('[data-test-card]')).toHaveLength(40);
    const moreBtn = container.querySelector<HTMLButtonElement>(
      '[data-compact-column-show-more="needsYou"]'
    );
    expect(moreBtn?.textContent).toContain(':55');

    fireEvent.click(moreBtn!);
    expect(container.querySelectorAll('[data-test-card]')).toHaveLength(80);

    act(() => {
      ioCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(container.querySelectorAll('[data-test-card]')).toHaveLength(95);
    expect(container.querySelector('[data-compact-column-show-more="needsYou"]')).toBeNull();
    unmount();

    // Fresh mount: pressing End from card 0 expands past 40 and focuses card #94.
    const fresh = render(<ControlledBoard />);
    expect(fresh.container.querySelectorAll('[data-test-card]')).toHaveLength(40);
    const first = fresh.container.querySelector<HTMLButtonElement>('[data-test-card="$item-0"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    const last = fresh.container.querySelector<HTMLButtonElement>('[data-test-card="$item-94"]');
    expect(last).not.toBeNull();
    expect(document.activeElement).toBe(last);
  });

  it('reorders via @dnd-kit mouse drag and grip-only touch drag, merges fullOrder, and ignores sub-threshold clicks', async () => {
    const onToggleFold = vi.fn();
    const onReorder = vi.fn();
    const { container } = render(
      <CompactThreadColumns
        sections={SECTIONS}
        folded={['done']}
        fullOrder={['needsYou', 'working', 'later', 'quiet', 'done']}
        onToggleFold={onToggleFold}
        onReorder={onReorder}
        renderCard={(id) => <div key={id} data-test-card={id} />}
      />
    );
    bindDynamicColumnRects(container);

    // Sub-threshold mouse press toggles fold on click without reordering.
    const needsHeader = container.querySelector<HTMLButtonElement>(
      '[data-compact-column-header="needsYou"]'
    )!;
    await act(async () => {
      needsHeader.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 20, bubbles: true })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 103, clientY: 20, bubbles: true })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 103, clientY: 20, bubbles: true })
      );
      await tick();
    });
    fireEvent.click(needsHeader);
    expect(onToggleFold).toHaveBeenCalledWith('needsYou');
    expect(onReorder).not.toHaveBeenCalled();

    // Touch drag outside the drag grip does NOT activate @dnd-kit (keeps native board panning).
    const doneRail = container.querySelector<HTMLButtonElement>(
      '[data-compact-column-rail="done"]'
    )!;
    await act(async () => {
      doneRail.dispatchEvent(touchEvent('touchstart', doneRail, 680, 30));
      doneRail.dispatchEvent(touchEvent('touchmove', doneRail, 100, 30));
      await tick();
    });
    expect(
      container.querySelector('[data-compact-column="done"]')?.getAttribute('data-dragging')
    ).toBeNull();
    await act(async () => {
      doneRail.dispatchEvent(touchEvent('touchend', doneRail, 100, 30));
      await tick();
    });
    expect(onReorder).not.toHaveBeenCalled();

    // Touch drag starting on the drag grip DOES activate @dnd-kit and commits merged order.
    const doneGrip = doneRail.querySelector<HTMLElement>('[data-compact-column-drag-grip]')!;
    await act(async () => {
      doneGrip.dispatchEvent(touchEvent('touchstart', doneGrip, 680, 30));
      await tick();
    });
    await act(async () => {
      doneGrip.dispatchEvent(touchEvent('touchmove', doneGrip, 660, 30));
      await tick();
    });
    await act(async () => {
      doneGrip.dispatchEvent(touchEvent('touchmove', doneGrip, 100, 30));
      await tick();
    });
    expect(
      container.querySelector('[data-compact-column="done"]')?.getAttribute('data-dragging')
    ).toBe('true');
    await act(async () => {
      doneGrip.dispatchEvent(touchEvent('touchend', doneGrip, 100, 30));
      await tick();
    });
    expect(onReorder).toHaveBeenLastCalledWith(['done', 'needsYou', 'later', 'quiet', 'working']);

    // Mouse drag from anywhere on the rail reorders cleanly and suppresses trailing click.
    onReorder.mockClear();
    await act(async () => {
      doneRail.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, clientX: 680, clientY: 30, bubbles: true })
      );
      await tick();
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 660, clientY: 30, bubbles: true })
      );
      await tick();
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 100, clientY: 30, bubbles: true })
      );
      await tick();
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 100, clientY: 30, bubbles: true })
      );
      await tick();
    });
    fireEvent.click(doneRail);
    expect(onToggleFold).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['done', 'needsYou', 'later', 'quiet', 'working']);
    // Wait for @dnd-kit's 50ms post-drag document click guard to detach cleanly.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('plays 260ms FLIP on collapse/expand with zero motion on mount or prefers-reduced-motion', () => {
    const animateCalls: Array<{ col: string; options: KeyframeAnimationOptions }> = [];
    const origAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = vi.fn(function (
      this: HTMLElement,
      _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      const opts = typeof options === 'object' && options ? options : {};
      animateCalls.push({ col: this.dataset.compactColumn ?? '', options: opts });
      return { cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation;
    });

    function StatefulBoard() {
      const [folded, setFolded] = useState<CompactThreadSectionId[]>(['done']);
      return (
        <CompactThreadColumns
          sections={SECTIONS}
          folded={folded}
          onToggleFold={(id) =>
            setFolded((prev) =>
              prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
            )
          }
          onReorder={vi.fn()}
          renderCard={(id) => <div key={id} data-test-card={id} />}
        />
      );
    }

    try {
      const { container, unmount } = render(<StatefulBoard />);
      bindDynamicColumnRects(container);
      expect(animateCalls).toHaveLength(0);

      fireEvent.click(container.querySelector('[data-compact-column-header="needsYou"]')!);
      expect(
        animateCalls.some(
          (call) => call.col === 'working' && call.options.duration === COLUMN_FLIP_DURATION_MS
        )
      ).toBe(true);
      unmount();

      // Reduced motion -> zero animate calls.
      animateCalls.length = 0;
      stubMatchMedia(true);
      const reduced = render(<StatefulBoard />);
      bindDynamicColumnRects(reduced.container);
      fireEvent.click(reduced.container.querySelector('[data-compact-column-header="needsYou"]')!);
      expect(animateCalls).toHaveLength(0);
    } finally {
      HTMLElement.prototype.animate = origAnimate;
    }
  });

  it('reorders via Alt+ArrowLeft/Right (swapped in RTL), keeps focus, and blocks window keydown propagation even at boundaries', () => {
    const windowKeydown = vi.fn();
    window.addEventListener('keydown', windowKeydown);

    function KeyboardBoard({ dir }: { dir: 'ltr' | 'rtl' }) {
      const [order, setOrder] = useState<CompactThreadSectionId[]>(['needsYou', 'working', 'done']);
      const ordered = order.map((id) => SECTIONS.find((section) => section.id === id)!);
      return (
        <div dir={dir} style={{ direction: dir }}>
          <CompactThreadColumns
            sections={ordered}
            folded={['done']}
            onToggleFold={vi.fn()}
            onReorder={setOrder}
            renderCard={(id) => <div key={id} data-test-card={id} />}
          />
        </div>
      );
    }

    try {
      const ltr = render(<KeyboardBoard dir="ltr" />);
      const workingBtn = ltr.container.querySelector<HTMLButtonElement>(
        '[data-compact-column-header="working"]'
      )!;
      workingBtn.focus();
      fireEvent.keyDown(workingBtn, { key: 'ArrowLeft', altKey: true });
      expect(columnOrder(ltr.container)).toEqual(['working', 'needsYou', 'done']);
      expect(document.activeElement).toBe(
        ltr.container.querySelector('[data-compact-column-header="working"]')
      );

      // Boundary press (already first column, Alt+ArrowLeft) must ALSO stop propagation to window.
      fireEvent.keyDown(workingBtn, { key: 'ArrowLeft', altKey: true });
      expect(columnOrder(ltr.container)).toEqual(['working', 'needsYou', 'done']);
      expect(windowKeydown).not.toHaveBeenCalled();

      // Boundary press on collapsed last rail (Alt+ArrowRight) must ALSO stop propagation to window.
      const doneRail = ltr.container.querySelector<HTMLButtonElement>(
        '[data-compact-column-rail="done"]'
      )!;
      doneRail.focus();
      fireEvent.keyDown(doneRail, { key: 'ArrowRight', altKey: true });
      expect(windowKeydown).not.toHaveBeenCalled();
      ltr.unmount();

      // In RTL, Alt+ArrowLeft moves forward (visually left = later index in flex row).
      const rtl = render(<KeyboardBoard dir="rtl" />);
      const rtlWorkingBtn = rtl.container.querySelector<HTMLButtonElement>(
        '[data-compact-column-header="working"]'
      )!;
      rtlWorkingBtn.focus();
      fireEvent.keyDown(rtlWorkingBtn, { key: 'ArrowLeft', altKey: true });
      expect(columnOrder(rtl.container)).toEqual(['needsYou', 'done', 'working']);
      expect(document.activeElement).toBe(
        rtl.container.querySelector('[data-compact-column-header="working"]')
      );
      expect(windowKeydown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowKeydown);
    }
  });
});
