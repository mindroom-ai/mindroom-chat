// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPACT_BOARD_INLINE_PADDING_PX,
  COMPACT_COLLAPSED_RAIL_WIDTH_PX,
  COMPACT_COLUMN_GAP_PX,
  COMPACT_COLUMN_INITIAL_CARDS,
  COMPACT_COLUMN_MIN_WIDTH_PX,
  COMPACT_COLUMNS_MIN_WIDTH_PX,
  findDragTargetIndex,
  getVisibleColumnCardIds,
  mergeVisibleSectionOrder,
} from './compactColumnsLayout';
import { useCompactColumnsAvailable } from './useCompactColumnsAvailable';
import { useCompactColumnsBoard } from './useCompactColumnsBoard';
import { COLUMN_DRAG_THRESHOLD_PX, COLUMN_FLIP_DURATION_MS } from './useCompactColumnMotion';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { CompactThreadColumns } from './CompactThreadColumns';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count !== undefined ? `${key}:${String(params.count)}` : key,
  }),
}));

vi.mock('../ThreadStreamingDot', () => ({
  ThreadStreamingDot: () => <span data-streaming-dot="true" />,
}));

const SECTIONS: CompactThreadSection[] = [
  { id: 'needsYou', rootIds: ['$alpha', '$beta'] },
  { id: 'working', rootIds: ['$gamma'] },
  { id: 'done', rootIds: ['$delta'] },
];

const pointerEvent = (
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: {
    pointerId: number;
    clientX?: number;
    clientY?: number;
    button?: number;
    pointerType?: string;
  }
): Event => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType ?? 'mouse' },
    isPrimary: { value: true },
  });
  return event;
};

const columnOrder = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>('[data-compact-column]')].map(
    (el) => el.dataset.compactColumn ?? ''
  );

const makeRect = (left: number, width: number): DOMRect => ({
  left,
  right: left + width,
  top: 0,
  bottom: 400,
  width,
  height: 400,
  x: left,
  y: 0,
  toJSON: () => ({}),
});

/**
 * Assigns deterministic horizontal layout rects based on current DOM order (wide open vs 40px rail)
 * and reflects inline `translate3d(Npx, ...)` transforms just like a real browser's `getBoundingClientRect`.
 */
const bindDynamicColumnRects = (container: HTMLElement, rtl = false) => {
  const columns = [...container.querySelectorAll<HTMLElement>('[data-compact-column]')];
  const boardWidth = 1000;
  columns.forEach((col) => {
    vi.spyOn(col, 'getBoundingClientRect').mockImplementation(() => {
      const siblings = [...container.querySelectorAll<HTMLElement>('[data-compact-column]')];
      let cursor = rtl ? boardWidth : 0;
      for (const sibling of siblings) {
        const w = sibling.dataset.collapsed === 'true' ? COMPACT_COLLAPSED_RAIL_WIDTH_PX : 320;
        const left = rtl ? cursor - w : cursor;
        if (sibling === col) {
          const match = /translate3d\(([-\d.]+)px/.exec(col.style.transform);
          const tx = match ? Number(match[1]) : 0;
          return makeRect(left + tx, w);
        }
        cursor = rtl ? left - COMPACT_COLUMN_GAP_PX : left + w + COMPACT_COLUMN_GAP_PX;
      }
      return makeRect(0, 320);
    });
  });
};

const stubMatchMedia = (reducedMotion: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reducedMotion && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
};

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compactColumnsLayout & useCompactColumnsAvailable', () => {
  it('derives COMPACT_COLUMNS_MIN_WIDTH_PX from structural column, rail, gap, and padding constants', () => {
    expect(COMPACT_COLUMNS_MIN_WIDTH_PX).toBe(
      2 * COMPACT_COLUMN_MIN_WIDTH_PX +
        3 * COMPACT_COLLAPSED_RAIL_WIDTH_PX +
        4 * COMPACT_COLUMN_GAP_PX +
        COMPACT_BOARD_INLINE_PADDING_PX
    );
    expect(
      mergeVisibleSectionOrder(
        ['needsYou', 'working', 'later', 'quiet', 'done'],
        ['working', 'needsYou', 'done']
      )
    ).toEqual(['working', 'needsYou', 'later', 'quiet', 'done']);
  });

  it('defaults to false without ResizeObserver and flips based on observed container width', () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const available = useCompactColumnsAvailable(ref);
      return <div ref={ref} data-available={String(available)} />;
    }

    vi.stubGlobal('ResizeObserver', undefined);
    const { container, unmount } = render(<Probe />);
    expect(container.firstElementChild?.getAttribute('data-available')).toBe('false');
    unmount();

    let cb: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          cb = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );

    const measured = render(<Probe />);
    expect(measured.container.firstElementChild?.getAttribute('data-available')).toBe('false');

    act(() => {
      cb?.(
        [{ contentRect: { width: COMPACT_COLUMNS_MIN_WIDTH_PX } } as ResizeObserverEntry],
        {} as ResizeObserver
      );
    });
    expect(measured.container.firstElementChild?.getAttribute('data-available')).toBe('true');

    act(() => {
      cb?.(
        [{ contentRect: { width: COMPACT_COLUMNS_MIN_WIDTH_PX - 1 } } as ResizeObserverEntry],
        {} as ResizeObserver
      );
    });
    expect(measured.container.firstElementChild?.getAttribute('data-available')).toBe('false');
  });

  it('uses oscillation-free hysteresis across wide open columns and 40px rails in LTR and RTL', () => {
    const ltrRects = new Map<CompactThreadSectionId, Pick<DOMRect, 'left' | 'right'>>([
      ['needsYou', { left: 0, right: 320 }],
      ['done', { left: 330, right: 370 }],
    ]);
    expect(findDragTargetIndex(['needsYou', 'done'], 0, 353, 340, ltrRects, (x) => x)).toBe(0);
    expect(findDragTargetIndex(['needsYou', 'done'], 0, 355, 340, ltrRects, (x) => x)).toBe(1);

    const swappedRects = new Map<CompactThreadSectionId, Pick<DOMRect, 'left' | 'right'>>([
      ['done', { left: 0, right: 40 }],
      ['needsYou', { left: 50, right: 370 }],
    ]);
    expect(findDragTargetIndex(['done', 'needsYou'], 1, 354, 355, swappedRects, (x) => x)).toBe(1);

    const rtlRects = new Map<CompactThreadSectionId, Pick<DOMRect, 'left' | 'right'>>([
      ['needsYou', { left: 680, right: 1000 }],
      ['done', { left: 630, right: 670 }],
    ]);
    expect(findDragTargetIndex(['needsYou', 'done'], 0, -645, -660, rtlRects, (x) => -x)).toBe(1);
  });
});

describe('CompactThreadColumns', () => {
  it('renders open headers, 90° collapsed rails with 0 mounted cards, live signals, and single-open count', () => {
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

  it('distinguishes clicks from drags, scopes touch drags to the grip only, reorders across mixed rails, and cancels on pointercancel', () => {
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
    fireEvent(
      needsHeader,
      pointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 20 })
    );
    fireEvent(
      window,
      pointerEvent('pointermove', {
        pointerId: 1,
        clientX: 100 + COLUMN_DRAG_THRESHOLD_PX - 2,
        clientY: 20,
      })
    );
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 104, clientY: 20 }));
    fireEvent.click(needsHeader);
    expect(onToggleFold).toHaveBeenCalledWith('needsYou');
    expect(onReorder).not.toHaveBeenCalled();

    // Touch drag outside the drag grip does NOT hijack horizontal board panning.
    const doneRail = container.querySelector<HTMLButtonElement>(
      '[data-compact-column-rail="done"]'
    )!;
    fireEvent(
      doneRail,
      pointerEvent('pointerdown', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 680,
        clientY: 30,
      })
    );
    fireEvent(
      window,
      pointerEvent('pointermove', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 400,
        clientY: 30,
      })
    );
    expect(
      container.querySelector('[data-compact-column="done"]')?.getAttribute('data-dragging')
    ).toBeNull();
    fireEvent(
      window,
      pointerEvent('pointerup', { pointerId: 10, pointerType: 'touch', clientX: 400, clientY: 30 })
    );

    // Touch drag starting on the drag grip DOES reorder cleanly.
    const doneGrip = doneRail.querySelector<HTMLElement>('[data-compact-column-drag-grip]')!;
    fireEvent(
      doneGrip,
      pointerEvent('pointerdown', {
        pointerId: 11,
        pointerType: 'touch',
        clientX: 680,
        clientY: 30,
      })
    );
    fireEvent(
      window,
      pointerEvent('pointermove', {
        pointerId: 11,
        pointerType: 'touch',
        clientX: 400,
        clientY: 30,
      })
    );
    expect(
      container.querySelector('[data-compact-column="done"]')?.getAttribute('data-dragging')
    ).toBe('true');
    expect(columnOrder(container)).toEqual(['needsYou', 'done', 'working']);

    // pointercancel reverts live order without committing.
    fireEvent(window, pointerEvent('pointercancel', { pointerId: 11, pointerType: 'touch' }));
    expect(columnOrder(container)).toEqual(['needsYou', 'working', 'done']);
    expect(onReorder).not.toHaveBeenCalled();

    // Mouse drag from anywhere on the rail commits merged order immediately on pointerup.
    fireEvent(
      doneRail,
      pointerEvent('pointerdown', { button: 0, pointerId: 3, clientX: 680, clientY: 30 })
    );
    fireEvent(window, pointerEvent('pointermove', { pointerId: 3, clientX: 100, clientY: 30 }));
    expect(columnOrder(container)).toEqual(['done', 'needsYou', 'working']);
    fireEvent(window, pointerEvent('pointerup', { pointerId: 3, clientX: 100, clientY: 30 }));
    fireEvent.click(doneRail);
    expect(onToggleFold).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['done', 'needsYou', 'later', 'quiet', 'working']);
  });

  it('plays unified 260ms FLIP on collapse, swap, and drop commit, with zero motion on mount or reduced motion', () => {
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

    const onReorder = vi.fn();
    function StatefulBoard() {
      const [folded, setFolded] = useState<CompactThreadSectionId[]>(['done']);
      const [order, setOrder] = useState<CompactThreadSectionId[]>(['needsYou', 'working', 'done']);
      const ordered = order.map((id) => SECTIONS.find((section) => section.id === id)!);
      return (
        <CompactThreadColumns
          sections={ordered}
          folded={folded}
          onToggleFold={(id) =>
            setFolded((prev) =>
              prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
            )
          }
          onReorder={(next) => {
            onReorder(next);
            setOrder(next);
          }}
          renderCard={(id) => <div key={id} data-test-card={id} />}
        />
      );
    }

    try {
      const { container, unmount } = render(<StatefulBoard />);
      bindDynamicColumnRects(container);
      expect(animateCalls).toHaveLength(0);

      // Collapsing needsYou glides shifted sibling columns with 260ms FLIP.
      fireEvent.click(container.querySelector('[data-compact-column-header="needsYou"]')!);
      expect(
        animateCalls.some(
          (call) => call.col === 'working' && call.options.duration === COLUMN_FLIP_DURATION_MS
        )
      ).toBe(true);
      animateCalls.length = 0;

      // Dragging working across needsYou glides sibling, then drop commits immediately and FLIPs working home.
      const workingHeader = container.querySelector<HTMLButtonElement>(
        '[data-compact-column-header="working"]'
      )!;
      fireEvent(
        workingHeader,
        pointerEvent('pointerdown', { button: 0, pointerId: 7, clientX: 200, clientY: 20 })
      );
      fireEvent(window, pointerEvent('pointermove', { pointerId: 7, clientX: 10, clientY: 20 }));
      expect(
        animateCalls.some(
          (call) => call.col === 'needsYou' && call.options.duration === COLUMN_FLIP_DURATION_MS
        )
      ).toBe(true);
      animateCalls.length = 0;

      fireEvent(window, pointerEvent('pointerup', { pointerId: 7, clientX: 10, clientY: 20 }));
      expect(onReorder).toHaveBeenCalledWith(['working', 'needsYou', 'done']);
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
