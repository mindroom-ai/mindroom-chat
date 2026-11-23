// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { stubCompactLayout, tickFrames as tick } from './compactBlocks.test.shared';
import { useCompactBlocks } from './useCompactBlocks';

const ids = Array.from({ length: 96 }, (_, i) => `$row${i}`);
const gap = 4.25;
const clientHeight = 480;
let width = 390;
let fontSize = 16;
const grown = new Set<string>();
const height = (id: string) =>
  grown.has(id)
    ? 300
    : ((Number(id.slice(4)) % 2 === 0 ? 81.25 : 109.5) * (width < 390 ? 1.5 : 1) * fontSize) / 16;
const getHeight = (row: HTMLElement) =>
  row.dataset.scrollAnchor === undefined
    ? Number.parseFloat(row.style.height) || 0
    : height(row.dataset.scrollAnchor) * (row.hasAttribute('inert') ? 0.96 : 1);

type Props = {
  memory?: ScrollAnchorMemory;
  shown?: Record<string, string[]>;
  records?: ReadonlyMap<string, ThreadRecord>;
  protectedId?: string;
  indexPending?: boolean;
  onIds?: (ids: string[]) => void;
  onEnd?: (prepareEnd: () => void) => void;
  roomId?: string;
  blank?: (id: string) => boolean;
};

function List(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const block = useCompactBlocks({
    ...props,
    memory: props.memory ?? new Map(),
    groups: props.shown ?? { cards: ids },
    roomId: props.roomId ?? '!room',
    scrollRef,
    contentRef,
  });
  props.onIds?.(block.liveIds);
  props.onEnd?.(block.prepareEnd);
  return (
    <div
      ref={scrollRef}
      data-view=""
      data-complete={block.extentComplete}
      data-ready={block.placeReady}
    >
      <div ref={contentRef} style={{ rowGap: gap, fontSize }}>
        {block.rows.flat().map((row) =>
          // eslint-disable-next-line no-nested-ternary
          typeof row === 'string' && props.blank?.(row) ? null : typeof row === 'string' ? (
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

let layout: ReturnType<typeof stubCompactLayout>;
const mount = (props: Props = {}) => {
  const memory = props.memory ?? new Map();
  const base = { ...props, memory };
  const rendered = render(<List {...base} />);
  const view = rendered.container.querySelector<HTMLElement>('[data-view]')!;
  return {
    view,
    memory,
    unmount: rendered.unmount,
    rerender: (next: Props = {}) => rendered.rerender(<List {...base} {...next} />),
  };
};
const anchor = (root: ParentNode, id: string) =>
  root.querySelector<HTMLElement>(`[data-scroll-anchor="${id}"]`);
const spacerHeight = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('[data-compact-spacer]')].reduce(
    (sum, el) => sum + Number.parseFloat(el.style.height),
    0
  );

beforeEach(() => {
  width = 390;
  fontSize = 16;
  grown.clear();
  vi.useFakeTimers();
  layout = stubCompactLayout({
    viewAttr: 'data-view',
    width: () => width,
    clientHeight,
    gap,
    rowHeight: getHeight,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('measures in blocks, slides without detaching staying cards, and remounts evicted rows without shifting', () => {
  const { view } = mount();
  expect(view.dataset.complete).toBe('false');
  tick(12);
  expect(view.dataset.complete).toBe('true');
  expect(anchor(view, '$row60')).toBeNull();

  const stays = anchor(view, '$row12');
  expect(view.firstElementChild?.firstElementChild?.hasAttribute('data-scroll-anchor')).toBe(true);
  const observer = new MutationObserver(() => {});
  observer.observe(view.firstElementChild!, { childList: true });
  layout.scroll(view, 15 * 199.25);
  expect(view.firstElementChild?.firstElementChild?.hasAttribute('data-compact-spacer')).toBe(true);
  expect(anchor(view, '$row12')).toBe(stays);
  expect(
    observer
      .takeRecords()
      .flatMap((r) => [...r.removedNodes])
      .filter((n) => n.isConnected)
  ).toEqual([]);
  observer.disconnect();

  const around = (key: string, top: number) => {
    layout.scroll(view, top);
    expect(anchor(view, key)!.getBoundingClientRect().top).toBe(0);
    expect(view.scrollTop).toBe(top);
  };
  around('$row60', 30 * 199.25);
  const space = view.querySelector('[data-compact-spacer="cards:"]');
  expect(space).not.toBeNull();
  act(() => {
    layout.resize();
    vi.advanceTimersByTime(17);
  });
  around('$row24', 12 * 199.25);
  expect(view.querySelector('[data-compact-spacer="cards:"]')).toBe(space);
  around('$row0', 0);
  expect(anchor(view, '$row60')).toBeNull();
});

it('remeasures evicted cards on width and font changes without shrinking or probing above a deep reader', () => {
  const { view, rerender } = mount();
  tick(12);
  expect(spacerHeight(view)).toBe(7168.75);
  fontSize = 24;
  rerender();
  expect(spacerHeight(view)).toBe(7168.75);
  tick(12);
  expect(spacerHeight(view)).toBe(10602.25);

  fontSize = 16;
  width = 320;
  rerender();
  layout.resize();
  tick(12);
  expect(spacerHeight(view)).toBe(10602.25);

  layout.scroll(view, 30 * 199.25 * 1.5);
  expect(anchor(view, '$row0')).toBeNull();
  fontSize = 24;
  rerender();
  tick(1);
  expect(anchor(view, '$row0')).toBeNull();
});

it('handles partial-index restores: retention on clamp, non-wheel takeover, and small-index readiness', () => {
  const id = '$row23';
  const clamped = mount({
    memory: new Map([['!room', { scrollTop: 1, anchors: [{ key: id, offset: 160 }] }]]),
    shown: { cards: ids.slice(0, 24) },
    indexPending: true,
  });
  Object.defineProperty(clamped.view, 'scrollHeight', { configurable: true, value: 1130 });
  clamped.view.scrollTop = 650;
  Object.defineProperty(clamped.view, 'scrollHeight', { value: 1180 });
  tick(1);
  clamped.rerender({ shown: { cards: [...ids.filter((r) => r !== id), id] } });
  expect(anchor(clamped.view, '$row23')).not.toBeNull();
  expect(anchor(clamped.view, '$row6')).not.toBeNull();
  clamped.unmount();

  const taken = mount({
    memory: new Map([['!room', { scrollTop: 3400, anchors: [{ key: '$row38', offset: 160 }] }]]),
    shown: { cards: ids.slice(0, 40) },
  });
  tick(6);
  layout.scroll(taken.view, 3400);
  layout.scroll(taken.view, 0);
  expect(anchor(taken.view, '$row0')).not.toBeNull();
  taken.unmount();

  const extent = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1030);
  const small = mount({
    memory: new Map([['!room', { scrollTop: 1, anchors: [{ key: '$row10', offset: 160 }] }]]),
    shown: { cards: ids.slice(0, 11) },
    indexPending: true,
  });
  expect(small.view.dataset.ready).toBe('false');
  extent.mockReturnValue(2020);
  small.rerender({ shown: { cards: ids.slice(0, 21) } });
  expect(small.view.dataset.ready).toBe('true');
});

it('bounds two distant runs, ignores no-op scrolls, and settles when empty', () => {
  const onIds = vi.fn();
  const distant = mount({
    memory: new Map([['!room', { scrollTop: 1, anchors: [{ key: '$row95', offset: 160 }] }]]),
    onIds,
  });
  expect(anchor(distant.view, '$row95')).not.toBeNull();
  layout.scroll(distant.view, 24 * (199.25 / 2) - 200);
  tick(12);
  expect(Math.max(...onIds.mock.calls.map((c) => (c[0] as string[]).length))).toBeLessThanOrEqual(
    72
  );
  distant.unmount();

  onIds.mockClear();
  const idle = mount({ onIds });
  tick(2);
  expect(idle.view.dataset.complete).toBe('false');
  const before = onIds.mock.calls.length;
  for (const top of [1, 2, 3]) layout.scroll(idle.view, top);
  expect(onIds.mock.calls.length).toBe(before);
  tick(12);
  expect(idle.view.dataset.complete).toBe('true');
  idle.unmount();

  onIds.mockClear();
  mount({ shown: { cards: [] }, onIds });
  tick(3);
  const renders = onIds.mock.calls.length;
  tick(6);
  expect(onIds.mock.calls.length).toBe(renders);
});

it('keeps 8 idle rooms plus saved-Back rooms, and ignores thrown-away renders', () => {
  const memory: ScrollAnchorMemory = new Map();
  const visit = (roomId: string) => {
    const r = mount({ memory, roomId });
    const warm = r.view.dataset.complete;
    tick(12);
    r.unmount();
    return warm;
  };
  const deep = mount({ memory, roomId: '!deep' });
  tick(12);
  layout.scroll(deep.view, 30 * 199.25);
  deep.unmount();
  memory.set('!deep', { scrollTop: 30 * 199.25, anchors: [{ key: '$row60', offset: 0 }] });

  for (let room = 0; room < 8; room += 1) expect(visit(`!room${room}`)).toBe('false');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() =>
    mount({
      memory,
      roomId: '!ninth',
      onIds: () => {
        throw new Error('thrown');
      },
    })
  ).toThrow();
  expect(visit('!room0')).toBe('true');
  expect(visit('!room8')).toBe('false');
  expect(visit('!room8')).toBe('true');
  expect(visit('!room1')).toBe('false');

  const back = mount({ memory, roomId: '!deep' });
  expect(back.view.dataset.ready).toBe('true');
  expect(back.view.dataset.complete).toBe('true');
  expect(anchor(back.view, '$row60')).not.toBeNull();
});

it('handles late blank-card models, ignores rebuilt records, and bounds bulk arrival', () => {
  const records = () => new Map(ids.map((id) => [id, {} as ThreadRecord]));
  const onIds = vi.fn();
  const rebuilt = mount({ blank: (id) => id === '$row60', records: records(), onIds });
  tick(12);
  expect(rebuilt.view.dataset.complete).toBe('true');
  rebuilt.rerender({ records: records() });
  expect(rebuilt.view.dataset.complete).toBe('true');
  expect(onIds.mock.lastCall?.[0]).not.toContain('$row60');
  rebuilt.unmount();

  const bulk = mount({ blank: () => true });
  tick(12);
  expect(bulk.view.dataset.complete).toBe('true');
  bulk.rerender({ blank: undefined, records: records() });
  expect(bulk.view.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(36);
  tick(12);
  expect(bulk.view.dataset.complete).toBe('true');
  expect(bulk.view.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(36);
  const extent = ([...bulk.view.firstElementChild!.children] as HTMLElement[]).reduce(
    (s, r) => s + getHeight(r) + gap,
    0
  );
  expect(extent).toBeCloseTo(ids.reduce((s, id) => s + height(id) + gap, 0));
  expect(anchor(bulk.view, '$row60')).toBeNull();
});

it('keeps observer, liveIds, and spacer stable on index refreshes, and rediscovers removed IDs', () => {
  const id = '$row80';
  const record = { status: { isUnread: true } } as ThreadRecord;
  const records = new Map([[id, record]]);
  const onIds = vi.fn();
  const { view, rerender } = mount({ records, onIds });
  tick(12);
  const lastIds = onIds.mock.lastCall?.[0];
  const measuredObservers = layout.observers;
  const spacer = view.querySelector('[data-compact-spacer]');
  rerender({
    records: new Map([[id, { ...record, status: { ...record.status, isUnread: false } }]]),
  });
  expect(onIds.mock.lastCall?.[0]).toBe(lastIds);
  expect(layout.observers).toBe(measuredObservers);
  expect(view.dataset.complete).toBe('true');
  expect(anchor(view, id)).toBeNull();
  expect(view.querySelector('[data-compact-spacer]')).toBe(spacer);

  const filtered = { cards: ids.filter((key) => key !== id) };
  rerender({ records, shown: filtered });
  rerender({ records, shown: { cards: ids } });
  expect(view.dataset.complete).toBe('true');
  rerender({ records: new Map(), shown: filtered });
  rerender({ records, shown: { cards: ids } });
  expect(view.dataset.complete).toBe('false');
  tick(2);
  expect(view.dataset.complete).toBe('true');
});

it('parks discovery and preserves extent while hidden, and ignores inert leave copies', () => {
  const onIds = vi.fn();
  const { view, rerender } = mount({ onIds });
  tick(2);
  width = 0;
  layout.resize();
  tick(2);
  const renders = onIds.mock.calls.length;
  tick(30);
  expect(onIds.mock.calls.length).toBe(renders);
  expect(view.dataset.complete).toBe('false');

  width = 390;
  layout.resize();
  tick(12);
  expect(view.dataset.complete).toBe('true');
  const measured = spacerHeight(view);
  width = 0;
  layout.resize();
  tick(12);
  rerender();
  expect(spacerHeight(view)).toBe(measured);
  width = 390;
  layout.resize();
  tick(12);
  expect(spacerHeight(view)).toBe(measured);

  const copy = document.createElement('div');
  copy.setAttribute('inert', '');
  copy.dataset.scrollAnchor = '$row60';
  view.firstElementChild!.append(copy);
  layout.resize();
  tick(2);
  copy.remove();
  rerender();
  expect(spacerHeight(view)).toBe(measured);
});

it('spaces resized mounted cards without extra renders, and places warm Back over stale font heights', () => {
  const onIds = vi.fn();
  const { view, memory, unmount } = mount({ onIds });
  tick(12);
  const renders = onIds.mock.calls.length;
  grown.add('$row3');
  layout.resize();
  tick(3);
  expect(onIds.mock.calls.length).toBe(renders);
  layout.scroll(view, 30 * 199.25 + 300 - height('$row1'));
  const first = ids.slice(0, 48).reduce((sum, id) => sum + height(id) + gap, -gap);
  expect(view.querySelector<HTMLElement>('[data-compact-spacer="cards:"]')?.style.height).toBe(
    `${first}px`
  );
  unmount();

  memory.set('!room', { scrollTop: 30 * 199.25, anchors: [{ key: '$row60', offset: 0 }] });
  fontSize = 24;
  const warm = mount({ memory });
  expect(warm.view.dataset.ready).toBe('true');
  expect(anchor(warm.view, '$row60')).not.toBeNull();
});

it('prepares the full last screen on End across short sections, releases on scroll/idle, and skips small lists', () => {
  let prepareEnd = () => {};
  const onEnd = (prepare: () => void) => {
    prepareEnd = prepare;
  };
  const shown = { working: ids.slice(0, 94), later: ids.slice(94, 95), done: ids.slice(95) };
  const grouped = mount({ shown, onEnd });
  tick(14);
  layout.scroll(grouped.view, 20 * 199.25);
  width = 320;
  layout.resize();
  tick(2);
  expect(anchor(grouped.view, '$row95')).toBeNull();
  act(() => prepareEnd());
  const mounted = [...grouped.view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].map(
    (r) => r.dataset.scrollAnchor
  );
  expect(mounted.slice(-24)).toEqual(ids.slice(72));
  expect(anchor(grouped.view, '$row95')?.nextElementSibling).toBeNull();
  layout.scroll(grouped.view, 20 * 199.25 + 1);
  expect(anchor(grouped.view, '$row95')).toBeNull();
  act(() => prepareEnd());
  const extent = () =>
    [...grouped.view.querySelectorAll<HTMLElement>('[data-view] > div > *')].reduce(
      (s, r) => s + getHeight(r) + gap,
      -gap
    );
  const prepared = extent();
  layout.scroll(grouped.view, prepared - clientHeight);
  expect(extent()).toBe(prepared);
  grouped.unmount();

  width = 390;
  const filtered = mount({ shown: { cards: ids.slice(0, 60) }, onEnd });
  tick(12);
  layout.scroll(filtered.view, 30 * 199.25 - clientHeight);
  act(() => prepareEnd());
  tick(1);
  filtered.rerender({ shown: { cards: ids } });
  expect(anchor(filtered.view, '$row59')).not.toBeNull();
  expect(anchor(filtered.view, '$row95')).toBeNull();
  filtered.unmount();

  const onIds = vi.fn();
  mount({ shown: { cards: ids.slice(0, 20) }, onIds, onEnd });
  tick(3);
  const renders = onIds.mock.calls.length;
  act(() => prepareEnd());
  expect(onIds.mock.calls.length).toBe(renders);
});

it('retains pressed, menu-protected, and dragged cards outside the window', () => {
  const { view, rerender } = mount();
  tick(12);
  const pointer = (el: Element, type: string) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    el.dispatchEvent(event);
  };
  const pressed = anchor(view, '$row0')!;
  pointer(pressed, 'pointerdown');
  layout.scroll(view, 6000);
  expect(pressed.isConnected).toBe(true);
  rerender({ protectedId: '$row0' });
  pointer(pressed, 'pointercancel');
  expect(pressed.isConnected).toBe(true);
  rerender({ protectedId: undefined });
  expect(pressed.isConnected).toBe(false);

  layout.scroll(view, 0);
  const dragged = anchor(view, '$row0')!;
  dragged.dispatchEvent(new Event('dragstart', { bubbles: true }));
  pointer(dragged, 'pointercancel');
  layout.scroll(view, 6000);
  expect(dragged.isConnected).toBe(true);
  dragged.dispatchEvent(new Event('dragend', { bubbles: true }));
  layout.scroll(view, 4300);
  expect(dragged.isConnected).toBe(false);
});
