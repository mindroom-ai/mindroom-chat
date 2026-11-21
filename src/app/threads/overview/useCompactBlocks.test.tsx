// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { useCompactBlocks } from './useCompactBlocks';

const ids = Array.from({ length: 96 }, (_, i) => `$row${i}`);
const groups = { cards: ids };
let width = 390;
let fontSize = 16;
const height = (id: string) =>
  ((Number(id.slice(4)) % 2 === 0 ? 81.25 : 109.5) * (width < 390 ? 1.5 : 1) * fontSize) / 16;
const gap = 4.25;
const clientHeight = 480;

function List({
  memory,
  shown = groups,
  records,
  protectedId,
}: {
  memory: ScrollAnchorMemory;
  shown?: Record<string, string[]>;
  records?: ReadonlyMap<string, ThreadRecord>;
  protectedId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const window = useCompactBlocks({
    groups: shown,
    scrollRef,
    contentRef,
    memory,
    roomId: '!room',
    records,
    protectedId,
  });
  return (
    <div
      ref={scrollRef}
      data-view=""
      data-complete={window.extentComplete}
      data-ready={window.placeReady}
    >
      <div ref={contentRef} style={{ rowGap: gap, fontSize }}>
        {window.rows[0]?.map((row) =>
          typeof row === 'string' ? (
            <button key={row} type="button" data-scroll-anchor={row}>
              {row}
            </button>
          ) : (
            <div
              key={`spacer:${row.key}`}
              data-compact-spacer={row.key}
              style={{ height: row.height }}
            />
          )
        )}
      </div>
    </div>
  );
}

let resize: () => void;
const getHeight = (row: HTMLElement) =>
  row.dataset.scrollAnchor === undefined
    ? Number.parseFloat(row.style.height) || 0
    : height(row.dataset.scrollAnchor);

beforeEach(() => {
  width = 390;
  fontSize = 16;
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(update: () => void) {
        resize = update;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement
  ) {
    if (this.hasAttribute('data-view')) return new DOMRect(0, 0, width, clientHeight);
    let top = 0 - (this.parentElement?.parentElement?.scrollTop ?? 0);
    for (
      let row = this.previousElementSibling;
      row instanceof HTMLElement;
      row = row.previousElementSibling
    ) {
      top += getHeight(row) + gap;
    }
    return new DOMRect(0, top, width, getHeight(this));
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('measures the tail in blocks, then remounts evicted rows without shifting the fractional extent', () => {
  const { container } = render(<List memory={new Map()} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  expect(view.dataset.complete).toBe('false');
  for (let frame = 0; frame < 12; frame += 1) {
    act(() => {
      vi.advanceTimersByTime(17);
    });
  }
  expect(view.dataset.complete).toBe('true');
  expect(view.querySelector('[data-scroll-anchor="$row60"]')).toBeNull();
  const around = (key: string, top: number) => {
    const originally = (view.scrollTop = top);
    act(() => {
      view.dispatchEvent(new Event('scroll'));
    });
    const row = view.querySelector<HTMLElement>(`[data-scroll-anchor="${key}"]`)!;
    expect(row.getBoundingClientRect().top).toBe(0);
    expect(view.scrollTop).toBe(originally);
  };
  // One short + one tall + two gaps occupy exactly 199.25px.
  const space = view.querySelector('[data-compact-spacer]');
  expect(space).not.toBeNull();
  around('$row60', 30 * 199.25);
  // Keep the measured gap in flow during the commit: WebKit clamps the native offset
  // if React tears down the old spacer before placing its replacement.
  expect(view.querySelector('[data-compact-spacer]')).toBe(space);
  act(() => {
    resize();
    vi.advanceTimersByTime(17);
  });
  around('$row24', 12 * 199.25);
  around('$row0', 0);
  expect(view.querySelector('[data-scroll-anchor="$row60"]')).toBeNull();
});

const tick = (frames: number) => {
  for (let i = 0; i < frames; i += 1) {
    act(() => {
      vi.advanceTimersByTime(17);
    });
  }
};

it('remeasures the evicted cards after the width changes', () => {
  const { container } = render(<List memory={new Map()} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  const space = () =>
    Number.parseFloat(view.querySelector<HTMLElement>('[data-compact-spacer]')!.style.height);
  tick(12);
  expect(space()).toBe(7168.75);
  width = 320;
  resize();
  tick(12);
  expect(space()).toBe(10602.25);
});

it('remeasures evicted cards after a font-size change without shrinking the old extent first', () => {
  const memory = new Map();
  const { container, rerender } = render(<List memory={memory} />);
  const space = () =>
    Number.parseFloat(container.querySelector<HTMLElement>('[data-compact-spacer]')!.style.height);
  tick(12);
  expect(space()).toBe(7168.75);
  fontSize = 24;
  rerender(<List memory={memory} />);
  expect(space()).toBe(7168.75);
  tick(12);
  expect(space()).toBe(10602.25);
});

it('does not insert a stale probe above the reader after a late font change', () => {
  const memory = new Map();
  const { container, rerender } = render(<List memory={memory} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(12);
  act(() => {
    view.scrollTop = 30 * 199.25;
    view.dispatchEvent(new Event('scroll'));
  });
  const first = () => view.querySelector('[data-scroll-anchor="$row0"]');
  expect(first()).toBeNull();
  fontSize = 24;
  rerender(<List memory={memory} />);
  tick(1);
  expect(first()).toBeNull();
});

it('can place a warm Back while occupied spacer heights await a font refresh', () => {
  const memory: ScrollAnchorMemory = new Map();
  const { unmount } = render(<List memory={memory} />);
  tick(12);
  unmount();
  memory.set('!room', { scrollTop: 30 * 199.25, anchors: [{ key: '$row60', offset: 0 }] });
  fontSize = 24;
  const { container } = render(<List memory={memory} />);
  expect(container.querySelector('[data-view]')?.getAttribute('data-ready')).toBe('true');
  expect(container.querySelector('[data-scroll-anchor="$row60"]')).not.toBeNull();
});

it('does not probe already measured offscreen rows on an index-only refresh', () => {
  const memory = new Map();
  const id = '$row80';
  const record = { status: { isUnread: true } } as ThreadRecord;
  const records = new Map([[id, record]]);
  const { container, rerender } = render(<List memory={memory} records={records} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(12);
  expect(view.dataset.complete).toBe('true');
  const spacer = view.querySelector('[data-compact-spacer]');
  rerender(
    <List
      memory={memory}
      records={new Map([[id, { ...record, status: { ...record.status, isUnread: false } }]])}
    />
  );
  expect(view.dataset.complete).toBe('true');
  expect(view.querySelector('[data-scroll-anchor="$row80"]')).toBeNull();
  expect(view.querySelector('[data-compact-spacer]')).toBe(spacer);
});

it('keeps filtered heights but rediscovers IDs that really left the index', () => {
  const memory = new Map();
  const id = '$row80';
  const records = new Map([[id, {} as ThreadRecord]]);
  const filtered = { cards: ids.filter((key) => key !== id) };
  const { container, rerender } = render(<List memory={memory} records={records} />);
  const complete = () => container.querySelector<HTMLElement>('[data-view]')?.dataset.complete;
  tick(12);
  expect(complete()).toBe('true');
  rerender(<List memory={memory} records={records} shown={filtered} />);
  rerender(<List memory={memory} records={records} />);
  expect(complete()).toBe('true');
  rerender(<List memory={memory} records={new Map()} shown={filtered} />);
  rerender(<List memory={memory} records={records} />);
  expect(complete()).toBe('false');
  tick(2);
  expect(complete()).toBe('true');
});

it('keeps the pressed card and then the open menu trigger outside the window', () => {
  const memory = new Map();
  const { container, rerender } = render(<List memory={memory} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(12);
  const first = view.querySelector('[data-scroll-anchor="$row0"]')!;
  const pointer = (type: string) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    first.dispatchEvent(event);
  };
  pointer('pointerdown');
  act(() => {
    view.scrollTop = 6000;
    view.dispatchEvent(new Event('scroll'));
  });
  expect(first.isConnected).toBe(true);
  rerender(<List memory={memory} protectedId="$row0" />);
  pointer('pointercancel');
  expect(first.isConnected).toBe(true);
  rerender(<List memory={memory} />);
  expect(first.isConnected).toBe(false);
});

it('retains a native drag source through pointercancel and evicts it after dragend', () => {
  const { container } = render(<List memory={new Map()} />);
  const scroller = container.querySelector<HTMLElement>('[data-view]')!;
  tick(12);
  const first = scroller.querySelector('[data-scroll-anchor="$row0"]')!;
  first.dispatchEvent(new Event('dragstart', { bubbles: true }));
  const cancel = new Event('pointercancel', { bubbles: true });
  Object.defineProperty(cancel, 'pointerId', { value: 1 });
  first.dispatchEvent(cancel);
  const move = (top: number) =>
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
    });
  move(6000);
  expect(first.isConnected).toBe(true);
  first.dispatchEvent(new Event('dragend', { bubbles: true }));
  move(4300);
  expect(first.isConnected).toBe(false);
});
