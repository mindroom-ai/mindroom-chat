// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForScrollQuiescence } from './scrollQuiescence';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('waitForScrollQuiescence', () => {
  let el: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
    vi.useRealTimers();
  });

  const settledFlag = (promise: Promise<void>) => {
    let settled = false;
    promise.then(() => {
      settled = true;
    });
    return () => settled;
  };

  it('resolves immediately for a null element', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(null));
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('resolves after the idle window when nothing is scrolling', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 150 }));
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    vi.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('keeps waiting while scroll events arrive (momentum in flight)', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 150 }));
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(100);
      el.dispatchEvent(new Event('scroll'));
    }
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    // Momentum ends: no more scroll events → idle window elapses.
    vi.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('does not resolve while a touch is active, even if the scroll is still', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 100 }));
    el.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    // Finger lifts with no momentum → idle window from touchend.
    el.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('maxWaitMs Infinity never force-resolves — only genuine quiescence settles', async () => {
    // Regression: passing a huge FINITE cap (Number.MAX_SAFE_INTEGER)
    // overflowed setTimeout's int32 delay, which browsers clamp to 0 —
    // the cap fired IMMEDIATELY and every ledger settle landed mid-ride
    // (the ios-momentum e2e caught it as per-frame settle bursts).
    // Infinity must mean "no cap timer at all".
    const isSettled = settledFlag(
      waitForScrollQuiescence(el, { idleMs: 150, maxWaitMs: Infinity })
    );
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    // A continuous stream far beyond any int32-overflow-clamped cap.
    for (let i = 0; i < 50; i += 1) {
      vi.advanceTimersByTime(100);
      el.dispatchEvent(new Event('scroll'));
    }
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    // Genuine quiet still resolves.
    vi.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('caps the total wait so a continuous scroller is never starved', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 150, maxWaitMs: 1000 }));
    // Scroll events keep arriving faster than the idle window forever.
    for (let i = 0; i < 9; i += 1) {
      vi.advanceTimersByTime(100);
      el.dispatchEvent(new Event('scroll'));
    }
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('touchcancel clears the touch-active block like touchend', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 100 }));
    el.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(300);
    el.dispatchEvent(new Event('touchcancel'));
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('blocks when a touch was already active BEFORE the wait started', async () => {
    // Greptile P1 on PR #75: the fetch can complete while the finger
    // is already down (drag-hold). The window-level tracker supplies
    // the initial touch state; without it the idle window would
    // resolve mid-touch and the restore write would fight the drag.
    window.dispatchEvent(new Event('touchstart'));
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 100 }));
    vi.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    window.dispatchEvent(new Event('touchend'));
    // The wait's own element listeners don't see a window-dispatched
    // touchend; the tracker does, and the next idle tick settles.
    vi.advanceTimersByTime(200);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('resolves immediately for a detached element', async () => {
    const detached = document.createElement('div');
    const isSettled = settledFlag(waitForScrollQuiescence(detached));
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('settles at the next idle tick when the element unmounts mid-wait', async () => {
    const isSettled = settledFlag(
      waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: 10_000 })
    );
    el.dispatchEvent(new Event('scroll'));
    el.remove();
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
    // Re-append for afterEach cleanup symmetry.
    document.body.appendChild(el);
  });
});
