// @vitest-environment jsdom
import { useLayoutEffect, useRef, useState } from 'react';
import { useDndContext } from '@dnd-kit/core';
import { hasSortableData } from '@dnd-kit/sortable';
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
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { CompactThreadColumns } from './CompactThreadColumns';
import { useCompactColumnsBoard } from './useCompactColumnsBoard';
import { COLUMN_FLIP_DURATION_MS } from './useCompactColumnMotion';

let language = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language, dir: () => (language === 'ar' ? 'rtl' : 'ltr') },
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
const bindDynamicColumnRects = (container: HTMLElement, width = 1000) => {
  const board = container.querySelector<HTMLElement>('[data-compact-columns-board]')!;
  vi.spyOn(board, 'getBoundingClientRect').mockImplementation(() => makeRect(0, width));
  const computeRect = (col: HTMLElement): DOMRect => {
    const columns = Array.from(board.querySelectorAll<HTMLElement>('[data-compact-column]'));
    const rtl =
      (getComputedStyle(board).direction || board.closest('[dir]')?.getAttribute('dir')) === 'rtl';
    let cursor = rtl ? width : 0;
    for (const item of columns) {
      const width =
        item.getAttribute('data-collapsed') === 'true' ? COMPACT_COLLAPSED_RAIL_WIDTH_PX : 320;
      const left = rtl ? cursor - width : cursor;
      if (item === col) return makeRect(left - board.scrollLeft, width);
      cursor = rtl ? left - COMPACT_COLUMN_GAP_PX : left + width + COMPACT_COLUMN_GAP_PX;
    }
    return makeRect(0, 0);
  };
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this === board) return makeRect(0, width);
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

  it('reveals cards on demand and restores horizontal and column scroll by scope', () => {
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

    function ControlledBoard({
      scrollMemory,
      scopeKey = '!room:test',
    }: {
      scrollMemory?: ScrollAnchorMemory;
      scopeKey?: string;
    }) {
      const viewRef = useRef<HTMLDivElement>(null);
      const fallbackMemory = useRef<ScrollAnchorMemory>(new Map());
      const board = useCompactColumnsBoard({
        viewRef,
        scopeKey,
        scrollMemory: scrollMemory ?? fallbackMemory.current,
        sections: bigSections,
        folded: ['done'],
      });
      return (
        <div ref={viewRef} data-compact-room-view="true">
          <CompactThreadColumns
            dir="rtl"
            boardRef={board.boardRef}
            sections={bigSections}
            folded={['done']}
            columnLimits={board.limits}
            scrollTops={board.scrollTops}
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

    const scrollMemory: ScrollAnchorMemory = new Map();
    const { container, unmount } = render(<ControlledBoard scrollMemory={scrollMemory} />);
    const boardEl = (root: HTMLElement) =>
      root.querySelector<HTMLElement>('[data-compact-columns-board]')!;
    const columnBody = (root: HTMLElement) =>
      root.querySelector<HTMLElement>('[data-compact-column-body="needsYou"]')!;
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
    boardEl(container).scrollLeft = -48;
    fireEvent.scroll(boardEl(container));
    columnBody(container).scrollTop = 500;
    fireEvent.scroll(columnBody(container));
    unmount();

    const restored = render(<ControlledBoard scrollMemory={scrollMemory} />);
    const restoredBoard = boardEl(restored.container);
    expect(restoredBoard.scrollLeft).toBe(-48);
    expect(columnBody(restored.container).scrollTop).toBe(500);
    expect(restored.container.querySelectorAll('[data-test-card]')).toHaveLength(95);
    restored.rerender(<ControlledBoard scrollMemory={scrollMemory} scopeKey="!room:test:8448" />);
    expect(restoredBoard.scrollLeft).toBe(0);
    expect(columnBody(restored.container).scrollTop).toBe(0);
    expect(restored.container.querySelectorAll('[data-test-card]')).toHaveLength(40);
    fireEvent.scroll(restoredBoard);
    restored.rerender(<ControlledBoard scrollMemory={scrollMemory} />);
    expect(restoredBoard.scrollLeft).toBe(-48);
    expect(columnBody(restored.container).scrollTop).toBe(500);
    expect(restored.container.querySelectorAll('[data-test-card]')).toHaveLength(95);
    restored.rerender(<ControlledBoard scrollMemory={scrollMemory} scopeKey="!room:test:8448" />);
    expect(restoredBoard.scrollLeft).toBe(0);
    restored.unmount();

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

  it('drags an open RTL column across a rail and pans within negative scroll bounds', async () => {
    const onReorder = vi.fn();
    const logical = ['needsYou', 'working', 'done'];
    const physical = [...logical].reverse();
    let containers: ReturnType<typeof useDndContext>['droppableContainers'] | undefined;
    function SortableProbe() {
      const { droppableContainers } = useDndContext();
      useLayoutEffect(() => {
        containers = droppableContainers;
      }, [droppableContainers]);
      return null;
    }
    const sortableIds = () => {
      const rail = containers?.get('done');
      return hasSortableData(rail) ? rail.data.current.sortable.items : undefined;
    };
    const html = document.documentElement;
    const previousDir = html.getAttribute('dir');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      html.removeAttribute('dir');
      const boardView = (dir?: 'ltr' | 'rtl') => (
        <div dir={dir}>
          <CompactThreadColumns
            sections={SECTIONS}
            folded={['done']}
            fullOrder={['needsYou', 'working', 'later', 'quiet', 'done']}
            style={{ overflowX: 'auto' }}
            onToggleFold={vi.fn()}
            onReorder={onReorder}
            renderCard={(id) => (id === '$alpha' ? <SortableProbe key={id} /> : null)}
          />
        </div>
      );
      const { container, rerender } = render(boardView());
      expect(sortableIds()).toEqual(logical);
      language = 'ar';
      rerender(boardView());
      expect(sortableIds()).toEqual(physical);
      html.dir = 'rtl';
      language = 'en';
      rerender(boardView());
      expect(sortableIds()).toEqual(physical);
      language = 'ar';
      rerender(boardView('ltr'));
      expect(sortableIds()).toEqual(logical);
      expect(columnOrder(container)).toEqual(logical);

      // A wrapper direction change is picked up at drag start, without a React render.
      container.firstElementChild!.setAttribute('dir', 'rtl');

      const board = container.querySelector<HTMLElement>('[data-compact-columns-board]')!;
      bindDynamicColumnRects(container, 680);
      Object.defineProperties(board, { clientWidth: { value: 680 }, scrollWidth: { value: 700 } });
      const working = container.querySelector<HTMLElement>('[data-compact-column="working"]')!;
      const rail = container.querySelector<HTMLElement>('[data-compact-column="done"]')!;
      const grip = working.querySelector<HTMLElement>('[data-compact-column-drag-grip]')!;
      const { left, width } = working.getBoundingClientRect();
      const startX = left + width / 2;
      const edgeX = 2;
      const touch = async (type: string, x: number) => {
        await act(async () => {
          grip.dispatchEvent(touchEvent(type, grip, x, 30));
          await tick();
        });
      };
      const advancePan = () =>
        act(() => {
          vi.advanceTimersToNextFrame();
        });
      try {
        await touch('touchstart', startX);
        await touch('touchmove', startX - 20);
        expect(sortableIds()).toEqual(physical);
        await touch('touchmove', edgeX);
        advancePan();
        expect(board.scrollLeft).toBeLessThan(0);
        advancePan();
        expect(board.scrollLeft).toBe(-20);
        fireEvent.scroll(board);
        expect(rail.style.transform.split(',')[0]).toBe(
          `translate3d(${width + COMPACT_COLUMN_GAP_PX}px`
        );
      } finally {
        await touch('touchend', edgeX);
      }
      expect(onReorder).toHaveBeenCalledWith(['needsYou', 'done', 'later', 'quiet', 'working']);
      await touch('touchmove', 675);
      advancePan();
      expect(board.scrollLeft).toBe(-20);
    } finally {
      cleanup();
      language = 'en';
      if (previousDir === null) html.removeAttribute('dir');
      else html.dir = previousDir;
      vi.useRealTimers();
      // Let the existing dnd-kit document click guard detach before the next test.
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });

  it('plays 260ms FLIP and keeps trigger focus when folding or expanding, with zero motion on mount or reduced motion', () => {
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
          renderCard={(id) => <button type="button" key={id} data-test-card={id} />}
        />
      );
    }

    try {
      const { container, unmount } = render(<StatefulBoard />);
      bindDynamicColumnRects(container);
      expect(animateCalls).toHaveLength(0);

      const trigger = (kind: 'header' | 'rail') =>
        container.querySelector<HTMLButtonElement>(`[data-compact-column-${kind}="needsYou"]`)!;
      // detail: 0 represents the native button click from keyboard activation in jsdom.
      for (const detail of [0, 1]) {
        const header = trigger('header');
        header.focus();
        fireEvent.click(header, { detail });
        const rail = trigger('rail');
        expect(rail).toBe(header);
        expect(document.activeElement).toBe(rail);
        fireEvent.click(rail, { detail });
        expect(trigger('header')).toBe(header);
        expect(document.activeElement).toBe(header);
      }

      // Safari clicks need not move focus off the card before the column folds.
      container.querySelector<HTMLButtonElement>('[data-test-card="$alpha"]')!.focus();
      fireEvent.click(trigger('header'), { detail: 1 });
      expect(document.activeElement).toBe(trigger('rail'));
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
        <div dir={dir}>
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
      const scrollIntoView = vi.fn();
      workingBtn.scrollIntoView = scrollIntoView;
      workingBtn.focus();
      fireEvent.keyDown(workingBtn, { key: 'ArrowLeft', altKey: true });
      expect(columnOrder(ltr.container)).toEqual(['working', 'needsYou', 'done']);
      expect(document.activeElement).toBe(workingBtn);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

      // Boundary press (already first column, Alt+ArrowLeft) must ALSO stop propagation to window.
      fireEvent.keyDown(workingBtn, { key: 'ArrowLeft', altKey: true });
      expect(columnOrder(ltr.container)).toEqual(['working', 'needsYou', 'done']);
      expect(windowKeydown).not.toHaveBeenCalled();

      // Boundary press on collapsed last rail (Alt+ArrowRight) must ALSO stop propagation to window.
      const doneRail = ltr.container.querySelector<HTMLButtonElement>(
        '[data-compact-column-rail="done"]'
      )!;
      doneRail.scrollIntoView = scrollIntoView;
      doneRail.focus();
      fireEvent.keyDown(doneRail, { key: 'ArrowRight', altKey: true });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
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
