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
const grown = new Set<string>();
const height = (id: string) =>
  grown.has(id)
    ? 300
    : ((Number(id.slice(4)) % 2 === 0 ? 81.25 : 109.5) * (width < 390 ? 1.5 : 1) * fontSize) / 16;
const gap = 4.25;
const clientHeight = 480;

function List({
  memory,
  shown = groups,
  records,
  protectedId,
  indexPending,
  onIds,
  onEnd,
  roomId = '!room',
}: {
  roomId?: string;
  memory: ScrollAnchorMemory;
  shown?: Record<string, string[]>;
  records?: ReadonlyMap<string, ThreadRecord>;
  protectedId?: string;
  indexPending?: boolean;
  onIds?: (ids: string[]) => void;
  onEnd?: (prepareEnd: () => void) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const window = useCompactBlocks({
    groups: shown,
    scrollRef,
    contentRef,
    memory,
    roomId,
    records,
    protectedId,
    indexPending,
  });
  onIds?.(window.liveIds);
  onEnd?.(window.prepareEnd);
  return (
    <div
      ref={scrollRef}
      data-view=""
      data-complete={window.extentComplete}
      data-ready={window.placeReady}
    >
      <div ref={contentRef} style={{ rowGap: gap, fontSize }}>
        {window.rows.flat().map((row) =>
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
let observers: number;
const getHeight = (row: HTMLElement) =>
  row.dataset.scrollAnchor === undefined
    ? Number.parseFloat(row.style.height) || 0
    : height(row.dataset.scrollAnchor) * (row.hasAttribute('inert') ? 0.96 : 1);

beforeEach(() => {
  observers = 0;
  width = 390;
  fontSize = 16;
  grown.clear();
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(update: () => void) {
        observers += 1;
        resize = update;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement
  ) {
    if (width === 0) return new DOMRect();
    if (this.hasAttribute('data-view')) return new DOMRect(0, 0, width, clientHeight);
    let top = 0 - (this.parentElement?.parentElement?.scrollTop ?? 0);
    for (
      let row = this.previousElementSibling;
      row instanceof HTMLElement;
      row = row.previousElementSibling
    ) {
      if (row.style.display !== 'none') top += getHeight(row) + gap;
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
  around('$row60', 30 * 199.25);
  // The spacer above the window keeps its node while the window moves under it.
  const space = view.querySelector('[data-compact-spacer="cards:"]');
  expect(space).not.toBeNull();
  act(() => {
    resize();
    vi.advanceTimersByTime(17);
  });
  around('$row24', 12 * 199.25);
  expect(view.querySelector('[data-compact-spacer="cards:"]')).toBe(space);
  around('$row0', 0);
  expect(view.querySelector('[data-scroll-anchor="$row60"]')).toBeNull();
});

it('slides the window without taking the cards that stay out of the page', () => {
  const { container } = render(<List memory={new Map()} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  for (let frame = 0; frame < 12; frame += 1) {
    act(() => {
      vi.advanceTimersByTime(17);
    });
  }
  const stays = view.querySelector('[data-scroll-anchor="$row12"]');
  expect(view.firstElementChild?.firstElementChild?.hasAttribute('data-scroll-anchor')).toBe(true);
  const observer = new MutationObserver(() => {});
  observer.observe(view.firstElementChild!, { childList: true });
  // The first spacer above the window appears: a card put back in the page loses the focus, and
  // the browser the place it scrolled to.
  act(() => {
    view.scrollTop = 15 * 199.25;
    view.dispatchEvent(new Event('scroll'));
  });
  expect(view.firstElementChild?.firstElementChild?.hasAttribute('data-compact-spacer')).toBe(true);
  expect(view.querySelector('[data-scroll-anchor="$row12"]')).toBe(stays);
  const moved = observer
    .takeRecords()
    .flatMap((record) => [...record.removedNodes])
    .filter((node) => node.isConnected);
  observer.disconnect();
  expect(moved).toEqual([]);
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

it('retains a saved card when the partial index clamps the restore', () => {
  const id = '$row23';
  const memory: ScrollAnchorMemory = new Map([
    ['!room', { scrollTop: 1, anchors: [{ key: id, offset: 160 }] }],
  ]);
  const { container, rerender } = render(
    <List memory={memory} shown={{ cards: ids.slice(0, 24) }} indexPending />
  );
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  Object.defineProperty(view, 'scrollHeight', { configurable: true, value: 1130 });
  view.scrollTop = 650;
  // Insets can increase the native range before the anchor lands.
  Object.defineProperty(view, 'scrollHeight', { value: 1180 });
  tick(1);
  rerender(
    <List
      memory={memory}
      shown={{ cards: [...ids.filter((root) => root !== id), id] }}
      indexPending
    />
  );
  expect(view.querySelector('[data-scroll-anchor="$row23"]')).not.toBeNull();
  // Discover the reordered prefix without dropping the rows at the current offset.
  expect(view.querySelector('[data-scroll-anchor="$row6"]')).not.toBeNull();
});

it('does not offer the saved place while the small pending index would clamp it', () => {
  const memory: ScrollAnchorMemory = new Map([
    ['!room', { scrollTop: 1, anchors: [{ key: '$row10', offset: 160 }] }],
  ]);
  const extent = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1030);
  const { container, rerender } = render(
    <List memory={memory} shown={{ cards: ids.slice(0, 11) }} indexPending />
  );
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  expect(view.dataset.ready).toBe('false');

  extent.mockReturnValue(2020);
  rerender(<List memory={memory} shown={{ cards: ids.slice(0, 21) }} indexPending />);
  expect(view.dataset.ready).toBe('true');
});

it('keeps the window bounded when a scroll shows two distant runs of cards side by side', () => {
  // A cold Back to the last card: its block mounts unmeasured, right under the first screen.
  const memory: ScrollAnchorMemory = new Map([
    ['!room', { scrollTop: 1, anchors: [{ key: '$row95', offset: 160 }] }],
  ]);
  const onIds = vi.fn();
  const { container } = render(<List memory={memory} onIds={onIds} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  expect(view.querySelector('[data-scroll-anchor="$row95"]')).not.toBeNull();
  // Before discovery goes on, the reader scrolls to where both runs show.
  act(() => {
    view.scrollTop = 24 * (199.25 / 2) - 200;
    view.dispatchEvent(new Event('scroll'));
  });
  tick(12);
  const most = Math.max(...onIds.mock.calls.map(([live]: [string[]]) => live.length));
  expect(most).toBeLessThanOrEqual(72);
});

it('leaves discovery to its frames when a scroll changes nothing in view', () => {
  const onIds = vi.fn();
  const { container } = render(<List memory={new Map()} onIds={onIds} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(2);
  expect(view.dataset.complete).toBe('false');
  const renders = onIds.mock.calls.length;
  for (const top of [1, 2, 3]) {
    act(() => {
      view.scrollTop = top;
      view.dispatchEvent(new Event('scroll'));
    });
  }
  expect(onIds.mock.calls.length).toBe(renders);
  tick(12);
  expect(view.dataset.complete).toBe('true');
});

it('keeps the measured heights of the rooms last shown, and lets the oldest go', () => {
  const memory = new Map();
  const visit = (roomId: string) => {
    const { container, unmount } = render(<List memory={memory} roomId={roomId} />);
    const warm = container.querySelector<HTMLElement>('[data-view]')!.dataset.complete;
    tick(12);
    unmount();
    return warm;
  };
  for (let room = 0; room < 9; room += 1) expect(visit(`!room${room}`)).toBe('false');
  expect(visit('!room8')).toBe('true');
  expect(visit('!room0')).toBe('false');
});

it('settles on a list without cards', () => {
  const onIds = vi.fn();
  render(<List memory={new Map()} shown={{ cards: [] }} onIds={onIds} />);
  tick(3);
  const renders = onIds.mock.calls.length;
  tick(6);
  expect(onIds.mock.calls.length).toBe(renders);
});

it('lets a scroll take over a pending restore without wheel input', () => {
  const id = '$row38';
  const memory: ScrollAnchorMemory = new Map([
    ['!room', { scrollTop: 1, anchors: [{ key: id, offset: 160 }] }],
  ]);
  const { container } = render(
    <List memory={memory} shown={{ cards: ids.slice(0, 40) }} indexPending />
  );
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(6);
  act(() => {
    view.scrollTop = 3400;
    view.dispatchEvent(new Event('scroll'));
  });
  act(() => {
    view.scrollTop = 0;
    view.dispatchEvent(new Event('scroll'));
  });
  expect(view.querySelector('[data-scroll-anchor="$row0"]')).not.toBeNull();
});

it('keeps the same observer and mounted IDs through an index-only refresh', () => {
  const memory = new Map();
  const onIds = vi.fn();
  const { rerender } = render(<List memory={memory} onIds={onIds} />);
  tick(12);
  const last = onIds.mock.lastCall?.[0];
  const measured = observers;
  rerender(
    <List
      memory={memory}
      onIds={onIds}
      records={new Map(ids.map((id) => [id, {} as ThreadRecord]))}
    />
  );
  expect(onIds.mock.lastCall?.[0]).toBe(last);
  expect(observers).toBe(measured);
});

it('keeps measured extent while the conversation is hidden', () => {
  const memory = new Map();
  const { container, rerender } = render(<List memory={memory} />);
  const extent = () =>
    [...container.querySelectorAll<HTMLElement>('[data-compact-spacer]')].reduce(
      (sum, spacer) => sum + parseFloat(spacer.style.height),
      0
    );
  tick(12);
  const measured = extent();
  width = 0;
  resize();
  tick(12);
  rerender(<List memory={memory} />);
  expect(extent()).toBe(measured);
  width = 390;
  resize();
  tick(12);
  expect(extent()).toBe(measured);
});

it('does not take the height of a card from the inert copy that animates its leave', () => {
  const memory = new Map();
  const { container, rerender } = render(<List memory={memory} />);
  const extent = () =>
    [...container.querySelectorAll<HTMLElement>('[data-compact-spacer]')].reduce(
      (sum, spacer) => sum + parseFloat(spacer.style.height),
      0
    );
  tick(12);
  const measured = extent();
  const copy = document.createElement('div');
  copy.setAttribute('inert', '');
  copy.dataset.scrollAnchor = '$row60';
  container.querySelector('[data-view] > div')!.append(copy);
  resize();
  tick(2);
  copy.remove();
  rerender(<List memory={memory} />);
  expect(extent()).toBe(measured);
});

it('parks discovery while the list has no size, and resumes it when the list shows', () => {
  const onIds = vi.fn();
  const { container } = render(<List memory={new Map()} onIds={onIds} />);
  tick(2);
  // Hidden before the extent is discovered, as under a panel that fills the room.
  width = 0;
  resize();
  tick(2);
  const renders = onIds.mock.calls.length;
  tick(30);
  expect(onIds.mock.calls.length).toBe(renders);
  expect(container.querySelector<HTMLElement>('[data-view]')?.dataset.complete).toBe('false');
  width = 390;
  resize();
  tick(12);
  expect(container.querySelector<HTMLElement>('[data-view]')?.dataset.complete).toBe('true');
});

it('mounts the cards a filter brings back into the band in the same commit', () => {
  const memory = new Map();
  const { container, rerender } = render(
    <List memory={memory} shown={{ cards: ids.filter((_, i) => i % 2 === 0) }} />
  );
  tick(12);
  rerender(<List memory={memory} />);
  const mounted = new Set(
    [...container.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].map(
      (row) => row.dataset.scrollAnchor
    )
  );
  expect(ids.slice(0, 24).filter((id) => !mounted.has(id))).toEqual([]);
});

it('places a warm Back on the saved cards that survive while the index still loads', () => {
  const memory: ScrollAnchorMemory = new Map();
  const { container: before, unmount } = render(<List memory={memory} />);
  tick(12);
  const left = before.querySelector<HTMLElement>('[data-view]')!;
  act(() => {
    left.scrollTop = 30 * 199.25;
    left.dispatchEvent(new Event('scroll'));
  });
  unmount();
  memory.set('!room', {
    scrollTop: 30 * 199.25,
    anchors: ['$row60', '$row61', '$row62'].map((key, i) => ({ key, offset: i * 100 })),
  });
  // One saved card was deleted meanwhile: the other two still vote for the place.
  const { container } = render(
    <List memory={memory} shown={{ cards: ids.filter((id) => id !== '$row61') }} indexPending />
  );
  expect(container.querySelector<HTMLElement>('[data-view]')?.dataset.ready).toBe('true');
  expect(container.querySelector('[data-scroll-anchor="$row60"]')).not.toBeNull();
});

it('does not render again when a mounted card resizes, and spaces it by its new height', () => {
  const onIds = vi.fn();
  const { container } = render(<List memory={new Map()} onIds={onIds} />);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(12);
  const renders = onIds.mock.calls.length;
  grown.add('$row3');
  resize();
  tick(3);
  expect(onIds.mock.calls.length).toBe(renders);
  act(() => {
    view.scrollTop = 30 * 199.25 + 300 - height('$row1');
    view.dispatchEvent(new Event('scroll'));
  });
  const first = ids.slice(0, 48).reduce((sum, id) => sum + height(id) + gap, -gap);
  expect(view.querySelector<HTMLElement>('[data-compact-spacer="cards:"]')?.style.height).toBe(
    `${first}px`
  );
});

it('mounts the end with its real heights before the scrollbar End reads the extent', () => {
  let prepareEnd = () => {};
  const { container } = render(
    <List
      memory={new Map()}
      onEnd={(prepare) => {
        prepareEnd = prepare;
      }}
    />
  );
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(12);
  const move = (top: number) =>
    act(() => {
      view.scrollTop = top;
      view.dispatchEvent(new Event('scroll'));
    });
  move(20 * 199.25);
  // Narrower: every card is taller, and the tail below the reader still has its old heights.
  width = 320;
  resize();
  tick(2);
  expect(view.querySelector('[data-scroll-anchor="$row95"]')).toBeNull();
  act(() => prepareEnd());
  const rows = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
  expect(rows.at(-1)?.dataset.scrollAnchor).toBe('$row95');
  expect(view.querySelector('[data-scroll-anchor="$row72"]')).not.toBeNull();
  expect(rows.at(-1)?.nextElementSibling).toBeNull();
  // The reader's own scroll lets the end go again.
  move(20 * 199.25 + 1);
  expect(view.querySelector('[data-scroll-anchor="$row95"]')).toBeNull();
});

it('mounts the whole last screen before End when the last sections are short', () => {
  let prepareEnd = () => {};
  // A long section, then two of one card each: the last screen is mostly the long one's tail.
  const shown = { working: ids.slice(0, 94), later: ids.slice(94, 95), done: ids.slice(95) };
  const { container } = render(
    <List
      memory={new Map()}
      shown={shown}
      onEnd={(prepare) => {
        prepareEnd = prepare;
      }}
    />
  );
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  tick(14);
  act(() => {
    view.scrollTop = 20 * 199.25;
    view.dispatchEvent(new Event('scroll'));
  });
  width = 320;
  resize();
  tick(2);
  act(() => prepareEnd());
  const mounted = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].map(
    (row) => row.dataset.scrollAnchor
  );
  // The long section's last block fills the screen, and the block before it is the buffer.
  expect(mounted.slice(-24)).toEqual(ids.slice(72));
  // The end is real, so the scroll to it mounts nothing more.
  const extent = () =>
    [...view.querySelectorAll<HTMLElement>('[data-view] > div > *')].reduce(
      (sum, row) => sum + getHeight(row) + gap,
      -gap
    );
  const prepared = extent();
  act(() => {
    view.scrollTop = prepared - clientHeight;
    view.dispatchEvent(new Event('scroll'));
  });
  expect(extent()).toBe(prepared);
});

it('keeps the stationary visible cards when the first jumps to the top', () => {
  const memory = new Map();
  const { container, rerender } = render(<List memory={memory} />);
  tick(12);
  const view = container.querySelector<HTMLElement>('[data-view]')!;
  act(() => {
    view.scrollTop = 30 * 199.25;
    view.dispatchEvent(new Event('scroll'));
  });
  const stationary = view.querySelector('[data-scroll-anchor="$row61"]');
  expect(stationary).not.toBeNull();
  rerender(
    <List memory={memory} shown={{ cards: [ids[60]!, ...ids.filter((_, i) => i !== 60)] }} />
  );
  expect(view.querySelector('[data-scroll-anchor="$row61"]')).toBe(stationary);
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
