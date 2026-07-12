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
      el.scrollTop += 10;
      el.dispatchEvent(new Event('scroll'));
    }
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    // Momentum ends. jsdom (like every scrollend-capable platform) closes
    // native momentum with a scrollend; the idle window then elapses.
    el.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('keeps waiting while sampled scrollTop changes without scroll events', async () => {
    el.scrollTop = 400;
    const isSettled = settledFlag(
      waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: Infinity })
    );

    // iOS can keep advancing compositor momentum while JavaScript scroll
    // event delivery pauses. A changed offset at the idle deadline proves
    // the scroller was not actually quiet, so it must earn a fresh full
    // idle window before the waiter resolves.
    vi.advanceTimersByTime(75);
    el.scrollTop = 320;
    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);

    vi.advanceTimersByTime(75);
    el.scrollTop = 240;
    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);

    vi.advanceTimersByTime(99);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('treats negative iOS rubber-band offsets as sampled movement', async () => {
    const isSettled = settledFlag(
      waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: Infinity })
    );

    vi.advanceTimersByTime(75);
    el.scrollTop = -12;
    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);

    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('does not round away fractional compositor movement', async () => {
    const isSettled = settledFlag(
      waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: Infinity })
    );

    vi.advanceTimersByTime(75);
    el.scrollTop = 0.25;
    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);

    vi.advanceTimersByTime(100);
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
    // Genuine quiet still resolves (the scroll sequence closes with its
    // scrollend on scrollend-capable platforms like jsdom).
    el.dispatchEvent(new Event('scrollend'));
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

  it('keeps the finite cap absolute while silent offset progress re-arms idle', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: 250 }));

    vi.advanceTimersByTime(75);
    el.scrollTop = 100;
    vi.advanceTimersByTime(25);
    vi.advanceTimersByTime(75);
    el.scrollTop = 200;
    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);

    vi.advanceTimersByTime(49);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    vi.advanceTimersByTime(1);
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

  it('page lifecycle transitions un-wedge a swallowed touchend (Infinity waits must not pend forever)', async () => {
    // Adversarial review 2026-07-07, periphery F1: if the platform ever
    // swallows a touchend (target unmounted mid-gesture, tab backgrounded
    // during a touch), the window tracker would report an active touch
    // for the rest of the session and every Infinity-cap wait — the
    // ledger settles — would never resolve. No real touch survives a
    // page lifecycle transition, so visibilitychange/pagehide re-zero
    // the model.
    window.dispatchEvent(new Event('touchstart'));
    // The touchend is never delivered — the wedge.
    const isSettled = settledFlag(
      waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: Infinity })
    );
    vi.advanceTimersByTime(5_000);
    await flushMicrotasks();
    expect(isSettled()).toBe(false);
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    vi.advanceTimersByTime(200);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  describe('scroll-session awareness (scrollend-capable platforms)', () => {
    // jsdom ships onscrollend natively, so the per-call feature detection
    // is already in the supported branch — the same environment every
    // WebKit >= 26.2 user runs.
    it('holds the settle open across a session pause until scrollend releases it', async () => {
      // The discarded-write rides: a touchless scrub session (scroll
      // indicator/trackpad — no touch events) pauses >150ms with the DOM
      // offset frozen. The idle window alone would settle mid-session and
      // the compositor discards the write (ride-trace-1783829722124
      // settles 491/617/650). With scrollend observable, the session's
      // scroll event holds the idle path until its scrollend arrives.
      const isSettled = settledFlag(
        waitForScrollQuiescence(el, { idleMs: 150, maxWaitMs: Infinity })
      );
      el.dispatchEvent(new Event('scroll'));
      // Scrub pause: far past the idle window, but the session never
      // ended — no settle.
      vi.advanceTimersByTime(150);
      await flushMicrotasks();
      expect(isSettled()).toBe(false);
      vi.advanceTimersByTime(600);
      await flushMicrotasks();
      expect(isSettled()).toBe(false);
      // Scrubber release → scrollend → one idle window later, true rest.
      el.dispatchEvent(new Event('scrollend'));
      vi.advanceTimersByTime(150);
      await flushMicrotasks();
      expect(isSettled()).toBe(true);
    });

    it('a swallowed scrollend degrades to a late settle via the session TTL, never starvation', async () => {
      const isSettled = settledFlag(
        waitForScrollQuiescence(el, { idleMs: 150, maxWaitMs: Infinity })
      );
      el.dispatchEvent(new Event('scroll'));
      // No scrollend ever arrives (delivery bug / exotic embedder). The
      // idle poll keeps re-arming until the session goes stale, then
      // settles — bounded, not wedged.
      vi.advanceTimersByTime(1499);
      await flushMicrotasks();
      expect(isSettled()).toBe(false);
      vi.advanceTimersByTime(151);
      await flushMicrotasks();
      expect(isSettled()).toBe(true);
    });

    it('platforms without scrollend keep the plain idle window', async () => {
      // Remove the native property for this test only: a scroll event
      // must not open a session that only scrollend could close.
      const descriptor = Object.getOwnPropertyDescriptor(window, 'onscrollend');
      delete (window as { onscrollend?: unknown }).onscrollend;
      try {
        expect('onscrollend' in window).toBe(false);
        const isSettled = settledFlag(
          waitForScrollQuiescence(el, { idleMs: 150, maxWaitMs: Infinity })
        );
        el.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(150);
        await flushMicrotasks();
        expect(isSettled()).toBe(true);
      } finally {
        if (descriptor) Object.defineProperty(window, 'onscrollend', descriptor);
      }
    });
  });

  it('resolves immediately for a detached element', async () => {
    const detached = document.createElement('div');
    const isSettled = settledFlag(waitForScrollQuiescence(detached));
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
  });

  it('settles at the next idle tick when the element unmounts mid-wait', async () => {
    const isSettled = settledFlag(waitForScrollQuiescence(el, { idleMs: 100, maxWaitMs: 10_000 }));
    el.dispatchEvent(new Event('scroll'));
    el.remove();
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(isSettled()).toBe(true);
    // Re-append for afterEach cleanup symmetry.
    document.body.appendChild(el);
  });
});
