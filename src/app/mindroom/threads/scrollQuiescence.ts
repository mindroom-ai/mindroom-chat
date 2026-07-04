/**
 * Task #125 follow-up (2026-07-04): iOS WebKit kills flick momentum the
 * moment anything writes `scrollTop` programmatically. The thread
 * back-pagination pipeline prepends events and then restores the scroll
 * anchor with exactly such writes — and because the scroll-driven
 * trigger deliberately fires DURING the flick (prefetch headroom), the
 * prepend commit used to land mid-momentum and stop the scroll dead on
 * finger release. Downward scrolling never prepends, which is why it
 * kept its inertia.
 *
 * The fix is to split fetch from commit: data is fetched while the
 * flick is in flight, but the RENDER COMMIT (state writes → offset
 * shift → anchor-restore scroll writes) waits for the scroller to be
 * quiescent — no scroll events for `idleMs` and no active touch. A
 * clamped scroller (momentum slammed into the top edge) stops emitting
 * scroll events, so the edge case resolves through the same idle path.
 *
 * `maxWaitMs` caps the wait so a pathological continuous scroller
 * still gets content (accepting one momentum kill) instead of being
 * starved; a capped commit is at worst the pre-fix behavior, once.
 */

export type WaitForScrollQuiescenceOptions = {
  // Quiet window with no scroll events (and no active touch) that
  // counts as quiescent.
  idleMs?: number;
  // Upper bound on the total wait; the promise always resolves.
  maxWaitMs?: number;
};

export const waitForScrollQuiescence = (
  scrollElement: HTMLElement | null,
  { idleMs = 150, maxWaitMs = 2500 }: WaitForScrollQuiescenceOptions = {}
): Promise<void> => {
  if (!scrollElement) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    let touchActive = false;
    let settled = false;

    const cleanup = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (capTimer !== undefined) clearTimeout(capTimer);
      scrollElement.removeEventListener('scroll', onActivity);
      scrollElement.removeEventListener('touchstart', onTouchStart);
      scrollElement.removeEventListener('touchend', onTouchEnd);
      scrollElement.removeEventListener('touchcancel', onTouchEnd);
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const armIdleTimer = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!touchActive) settle();
        // With a finger down, stay armed: the next touchend re-arms.
      }, idleMs);
    };

    function onActivity() {
      armIdleTimer();
    }
    function onTouchStart() {
      touchActive = true;
    }
    function onTouchEnd() {
      touchActive = false;
      armIdleTimer();
    }

    scrollElement.addEventListener('scroll', onActivity, { passive: true });
    scrollElement.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollElement.addEventListener('touchend', onTouchEnd, { passive: true });
    scrollElement.addEventListener('touchcancel', onTouchEnd, { passive: true });

    capTimer = setTimeout(settle, maxWaitMs);
    armIdleTimer();
  });
};
