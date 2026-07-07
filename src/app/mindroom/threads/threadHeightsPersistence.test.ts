import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildThreadLayoutKey,
  createThreadHeightsPersister,
  synthesizeInitialMeasurements,
} from './threadHeightsPersistence';

const saveMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./cacheStore/cacheStoreHeights', () => ({
  saveCachedThreadHeights: saveMock,
}));

const makeEvent = (id: string) => ({ getId: () => id });

describe('buildThreadLayoutKey', () => {
  it('changes when any layout ingredient changes (heights are wrap-width truths)', () => {
    const base = { containerWidth: 393.4, messageLayout: 1, messageSpacing: '300', pageZoom: 100 };
    const key = buildThreadLayoutKey(base);
    expect(key).toBe('393|1|300|100');
    expect(buildThreadLayoutKey({ ...base, containerWidth: 800 })).not.toBe(key);
    expect(buildThreadLayoutKey({ ...base, messageLayout: 0 })).not.toBe(key);
    expect(buildThreadLayoutKey({ ...base, messageSpacing: '400' })).not.toBe(key);
    expect(buildThreadLayoutKey({ ...base, pageZoom: 120 })).not.toBe(key);
  });
});

describe('synthesizeInitialMeasurements', () => {
  it('emits only seeded rows, index-ordered against the CURRENT list, with cumulative starts', () => {
    // Persisted under an older, shorter list; the current list has a new
    // row prepended at index 1 — seeded indexes/starts must follow the
    // CURRENT order, not the stale snapshot.
    const events = [makeEvent('$root'), makeEvent('$new'), makeEvent('$a'), makeEvent('$b')];
    const heights = { $a: 150, $b: 90, $gone: 500 };
    const estimate = (index: number) => 10 + index; // distinguishable estimates
    const items = synthesizeInitialMeasurements(events, heights, estimate);
    expect(items).toEqual([
      // start = est(0)=10 + est(1)=11 = 21
      { index: 2, key: '$a', size: 150, start: 21, end: 171, lane: 0 },
      { index: 3, key: '$b', size: 90, start: 171, end: 261, lane: 0 },
    ]);
  });

  it('returns empty for empty seeds (virtual-core then estimates everything)', () => {
    expect(synthesizeInitialMeasurements([makeEvent('$x')], {}, () => 30)).toEqual([]);
  });
});

describe('createThreadHeightsPersister', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const snapshot = [
    { index: 0, key: '$a', size: 150.4, start: 0, end: 150, lane: 0 },
    { index: 1, key: 7, size: 30, start: 150, end: 180, lane: 0 }, // numeric key: placeholder row
    { index: 2, key: '$b', size: 90, start: 180, end: 270, lane: 0 },
  ];

  const make = () =>
    createThreadHeightsPersister({
      sessionId: 's1',
      roomId: '!r',
      threadId: '$t',
      getLayoutKey: () => 'k1',
      takeSnapshot: () => snapshot as never,
    });

  it('trailing debounce: repeated arms collapse into one save with rounded string-keyed heights', () => {
    const persister = make();
    persister.arm();
    vi.advanceTimersByTime(500);
    persister.arm();
    vi.advanceTimersByTime(999);
    expect(saveMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('s1', '!r', '$t', 'k1', { $a: 150, $b: 90 });
    persister.dispose();
  });

  it('flush saves immediately and cancels the pending timer; empty snapshots never save', () => {
    const persister = make();
    persister.arm();
    persister.flush();
    expect(saveMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(saveMock).toHaveBeenCalledTimes(1);
    persister.dispose();

    const empty = createThreadHeightsPersister({
      sessionId: 's1',
      roomId: '!r',
      threadId: '$t',
      getLayoutKey: () => 'k1',
      takeSnapshot: () => [],
    });
    empty.flush();
    expect(saveMock).toHaveBeenCalledTimes(1);
    empty.dispose();
  });

  it('dispose makes arm and pending timers inert', () => {
    const persister = make();
    persister.arm();
    persister.dispose();
    persister.arm();
    vi.advanceTimersByTime(5_000);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
