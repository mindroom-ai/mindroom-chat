// @vitest-environment jsdom
import { Virtualizer } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBatchedMeasurementRef } from './batchedMeasurementRef';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function setup() {
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe;

      unobserve = unobserve;

      disconnect = disconnect;
    }
  );
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 30,
    estimateSize: () => 50,
    getScrollElement: () => scroller,
    scrollToFn: () => {},
    observeElementRect: (_instance, callback) => callback({ width: 390, height: 844 }),
    observeElementOffset: (_instance, callback) => callback(0, false),
  });
  const dispose = virtualizer._didMount();
  virtualizer._willUpdate();
  const measure = vi.fn(virtualizer.measureElement);
  const ref = createBatchedMeasurementRef(measure);
  const mount = (index: number) => {
    const row = document.createElement('div');
    row.dataset.index = String(index);
    Object.defineProperty(row, 'offsetHeight', { value: 80 });
    scroller.append(row);
    ref(row);
    return row;
  };
  return { virtualizer, ref, mount, measure, unobserve, disconnect, dispose };
}

describe('batched virtualizer measurement ref', () => {
  it('measures attached rows immediately and cleans a removal burst once after DOM deletion', async () => {
    const { virtualizer, ref, mount, measure, unobserve, dispose } = setup();
    const rows = Array.from({ length: 20 }, (_, index) => mount(index));
    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    expect(virtualizer.elementsCache.size).toBe(20);
    measure.mockClear();
    rows.forEach((row) => {
      // React detaches refs before removing their DOM nodes.
      ref(null);
      row.remove();
    });
    expect(measure).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith(null);
    expect(virtualizer.elementsCache.size).toBe(0);
    expect(unobserve).toHaveBeenCalledTimes(20);
    dispose();
  });

  it('keeps a newly attached replacement for the same key', async () => {
    const { virtualizer, ref, mount, unobserve, dispose } = setup();
    const oldRow = mount(0);
    ref(null);
    oldRow.remove();
    const replacement = mount(0);
    await Promise.resolve();
    expect(virtualizer.elementsCache.get(0)).toBe(replacement);
    expect(unobserve).toHaveBeenCalledTimes(1);
    expect(unobserve).toHaveBeenCalledWith(oldRow);
    dispose();
  });

  it('releases cached nodes when the entire timeline unmounts before the microtask', async () => {
    const { virtualizer, ref, mount, disconnect, dispose } = setup();
    const row = mount(0);
    ref(null);
    row.remove();
    dispose();
    await Promise.resolve();
    expect(virtualizer.elementsCache.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
