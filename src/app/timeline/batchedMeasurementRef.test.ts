// @vitest-environment jsdom
import { Virtualizer } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBatchedMeasurementRef,
  createScrollMountMeasurement,
  measureMountedRows,
} from './batchedMeasurementRef';

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
  const scrollToFn = vi.fn();
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 30,
    estimateSize: () => 50,
    getScrollElement: () => scroller,
    scrollToFn,
    observeElementRect: (_instance, callback) => callback({ width: 390, height: 844 }),
    observeElementOffset: (_instance, callback) => callback(0, false),
  });
  const dispose = virtualizer._didMount();
  virtualizer._willUpdate();
  const measure = vi.fn(virtualizer.measureElement);
  const ref = createBatchedMeasurementRef(measure);
  const mount = (index: number, attach: (node: HTMLDivElement) => void = ref) => {
    const row = document.createElement('div');
    row.dataset.index = String(index);
    Object.defineProperty(row, 'offsetHeight', { value: 80 });
    scroller.append(row);
    attach(row);
    return row;
  };
  return { virtualizer, ref, mount, measure, scrollToFn, unobserve, disconnect, dispose };
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

  it('measures a row attached during a live scroll before the browser paints', async () => {
    const { virtualizer, mount, dispose } = setup();
    const notify = vi.fn();
    virtualizer.setOptions({ ...virtualizer.options, onChange: notify });
    virtualizer.isScrolling = true;

    // virtual-core alone leaves the row at its estimate until ResizeObserver
    // reports it, which re-renders after the browser has painted.
    mount(0, virtualizer.measureElement);
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.has(0)).toBe(false);

    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    mount(1, ref);
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.get(1)).toBe(80);
    expect(virtualizer.getVirtualItems()[2]?.start).toBe(50 + 80);
    expect(notify).toHaveBeenCalled();
    dispose();
  });

  it('measures the height a row settles on after updates queued by its own mount', async () => {
    const { virtualizer, dispose } = setup();
    virtualizer.isScrolling = true;
    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    const row = document.createElement('div');
    row.dataset.index = '0';
    let height = 90;
    Object.defineProperty(row, 'offsetHeight', { get: () => height });
    virtualizer.scrollElement?.append(row);
    ref(row);
    // A child layout effect corrects its first pass in a nested synchronous
    // render after the tile ref has attached.
    height = 80;
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    dispose();
  });

  it('caches the height a row mounted at rest settles on, even if it unmounts before ResizeObserver', async () => {
    const { virtualizer, dispose } = setup();
    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    const notify = vi.fn();
    virtualizer.setOptions({ ...virtualizer.options, onChange: notify });
    const row = document.createElement('div');
    row.dataset.index = '0';
    let height = 90;
    Object.defineProperty(row, 'offsetHeight', { get: () => height });
    virtualizer.scrollElement?.append(row);
    ref(row);
    // virtual-core measures at rest in the ref, before the row's first-pass
    // child update has flushed.
    expect(virtualizer.itemSizeCache.get(0)).toBe(90);
    height = 80;
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    expect(virtualizer.getVirtualItems()[1]?.start).toBe(80);
    expect(notify).toHaveBeenCalled();

    // The row unmounts before any ResizeObserver entry; a remount during a
    // scroll reuses the settled height rather than the first pass.
    ref(null);
    row.remove();
    virtualizer.isScrolling = true;
    const remounted = document.createElement('div');
    remounted.dataset.index = '0';
    Object.defineProperty(remounted, 'offsetHeight', { value: 80 });
    virtualizer.scrollElement?.append(remounted);
    ref(remounted);
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    dispose();
  });

  it('reuses a cached size when a measured row remounts during a scroll', async () => {
    const { virtualizer, mount, dispose } = setup();
    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    mount(0, ref);
    virtualizer.isScrolling = true;
    const notify = vi.fn();
    virtualizer.setOptions({ ...virtualizer.options, onChange: notify });
    const remounted = document.createElement('div');
    remounted.dataset.index = '0';
    const offsetHeight = vi.fn(() => 120);
    Object.defineProperty(remounted, 'offsetHeight', { get: offsetHeight });
    virtualizer.scrollElement?.append(remounted);
    ref(remounted);
    await Promise.resolve();
    expect(offsetHeight).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    dispose();
  });

  it('keeps virtual-core measuring only near the target of a smooth programmatic scroll', async () => {
    const { virtualizer, mount, dispose } = setup();
    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    virtualizer.scrollToIndex(25, { behavior: 'smooth' });
    virtualizer.isScrolling = true;
    mount(0, ref);
    mount(25, ref);
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.has(0)).toBe(false);
    expect(virtualizer.itemSizeCache.get(25)).toBe(80);
    dispose();
  });

  it('measures only near the target of a smooth programmatic scroll at a new width', () => {
    const { virtualizer, mount, dispose } = setup();
    const rows = [mount(0), mount(25)];
    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    const wrapTo = (height: number) =>
      rows.forEach((row) => Object.assign(row, { getBoundingClientRect: () => ({ height }) }));

    // At rest, a new width's scan gives every mounted row its new height.
    wrapTo(120);
    const beforeRow = vi.fn();
    measureMountedRows(virtualizer, beforeRow);
    expect(beforeRow).toHaveBeenCalledTimes(2);
    expect(virtualizer.itemSizeCache.get(0)).toBe(120);

    // While virtual-core scrolls smoothly to row 25, a row far from it keeps its size, as it
    // does for virtual-core's own observer: its new size would move the scroll's target.
    virtualizer.scrollToIndex(25, { behavior: 'smooth' });
    wrapTo(160);
    beforeRow.mockClear();
    measureMountedRows(virtualizer, beforeRow);
    expect(beforeRow).toHaveBeenCalledTimes(1);
    expect(virtualizer.itemSizeCache.get(0)).toBe(120);
    expect(virtualizer.itemSizeCache.get(25)).toBe(160);
    dispose();
  });

  it('batches a multi-row mount pass through _resizeBatch into a single notify', async () => {
    const { virtualizer, mount, dispose } = setup();
    virtualizer.scrollOffset = 600;
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => true;
    const notify = vi.fn();
    virtualizer.setOptions({ ...virtualizer.options, onChange: notify });
    virtualizer.isScrolling = true;

    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    mount(0, ref);
    mount(1, ref);
    mount(2, ref);
    mount(3, ref);
    await Promise.resolve();

    expect(virtualizer.itemSizeCache.get(0)).toBe(80);
    expect(virtualizer.itemSizeCache.get(3)).toBe(80);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(virtualizer, true);
    dispose();
  });

  it('skips rows that React removed before the measurement ran', async () => {
    const { virtualizer, mount, dispose } = setup();
    virtualizer.isScrolling = true;
    const ref = createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer));
    const row = mount(0, ref);
    row.remove();
    await Promise.resolve();
    expect(virtualizer.itemSizeCache.has(0)).toBe(false);
    dispose();
  });
});
