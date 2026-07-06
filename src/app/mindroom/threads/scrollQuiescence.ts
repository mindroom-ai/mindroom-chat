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

// The shared "quiet window" used by every scroll-quiescence consumer.
export const SCROLL_QUIESCENCE_IDLE_MS = 150;

export type WaitForScrollQuiescenceOptions = {
  // Quiet window with no scroll events (and no active touch) that
  // counts as quiescent.
  idleMs?: number;
  // Upper bound on the total wait; the promise always resolves.
  maxWaitMs?: number;
};

// Window-level active-touch tracker (greptile P1 on PR #75): a wait
// that starts while a finger is ALREADY down would otherwise see no
// touchstart and no scroll events (drag-hold), and resolve mid-touch.
// The tracker observes touches from module load, so the initial
// touchActive state is correct regardless of call ordering. Listeners
// are passive and capture-phase (they must see touches that targets
// stopPropagation on).
let windowActiveTouches = 0;
let touchTrackerInstalled = false;
const installTouchTracker = () => {
  if (touchTrackerInstalled || typeof window === 'undefined') return;
  touchTrackerInstalled = true;
  // `touches` is read defensively: synthetic Events (tests, exotic
  // embedders) may lack it.
  const readActiveTouches = (event: Event): number =>
    (event as TouchEvent).touches?.length ?? 0;
  window.addEventListener(
    'touchstart',
    (event) => {
      windowActiveTouches = Math.max(readActiveTouches(event), 1);
    },
    { passive: true, capture: true }
  );
  const onTouchSettle = (event: Event) => {
    windowActiveTouches = readActiveTouches(event);
  };
  window.addEventListener('touchend', onTouchSettle, { passive: true, capture: true });
  window.addEventListener('touchcancel', onTouchSettle, { passive: true, capture: true });
};
installTouchTracker();

export const waitForScrollQuiescence = (
  scrollElement: HTMLElement | null,
  { idleMs = SCROLL_QUIESCENCE_IDLE_MS, maxWaitMs = 2500 }: WaitForScrollQuiescenceOptions = {}
): Promise<void> => {
  // Detached elements can't scroll and their touchend may never fire —
  // resolve immediately (gemini on PR #75).
  if (!scrollElement || !scrollElement.isConnected) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (capTimer !== undefined) clearTimeout(capTimer);
      scrollElement.removeEventListener('scroll', onActivity);
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    // Touch state has a SINGLE source of truth: the window-level
    // tracker (counts remaining touches, capture phase, observing from
    // module load). A per-wait element flag was removed after PR #75
    // review round 7 — any local boolean can wedge (stuck true blocks
    // until the cap; stuck false is covered by the tracker anyway),
    // and the tracker sees every touch the element would.
    const armIdleTimer = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Element unmounted mid-wait: settle rather than ride out the
        // cap (gemini on PR #75).
        if (!scrollElement.isConnected) {
          settle();
          return;
        }
        if (windowActiveTouches === 0) {
          settle();
          return;
        }
        // A finger is still down: re-arm and poll at idle granularity
        // (a touchend elsewhere has no element event to re-arm
        // through). Bounded by the cap timer.
        armIdleTimer();
      }, idleMs);
    };

    function onActivity() {
      armIdleTimer();
    }

    scrollElement.addEventListener('scroll', onActivity, { passive: true });

    capTimer = setTimeout(settle, maxWaitMs);
    armIdleTimer();
  });
};
