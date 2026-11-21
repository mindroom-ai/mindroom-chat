// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { useCompactBlocks } from './useCompactBlocks';

const ids = Array.from({ length: 96 }, (_, i) => `$row${i}`);
const groups = [ids];
const height = (id: string) => (Number(id.slice(4)) % 2 === 0 ? 81.25 : 109.5);
const gap = 4.25;
const clientHeight = 480;

function List({ memory }: { memory: ScrollAnchorMemory }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const window = useCompactBlocks({ groups, scrollRef, contentRef, memory, roomId: '!room' });
  return (
    <div ref={scrollRef} data-view="" data-complete={window.extentComplete}>
      <div ref={contentRef} style={{ rowGap: gap }}>
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
    if (this.hasAttribute('data-view')) return new DOMRect(0, 0, 390, clientHeight);
    let top = 0 - (this.parentElement?.parentElement?.scrollTop ?? 0);
    for (
      let row = this.previousElementSibling;
      row instanceof HTMLElement;
      row = row.previousElementSibling
    ) {
      top += getHeight(row) + gap;
    }
    return new DOMRect(0, top, 390, getHeight(this));
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
  act(() => {
    resize();
    vi.advanceTimersByTime(17);
  });
  around('$row24', 12 * 199.25);
  around('$row0', 0);
  expect(view.querySelector('[data-scroll-anchor="$row60"]')).toBeNull();
});
