import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { readScrollPadding } from './styles/threadHeaderInset';

/** Clearance left above a disclosure toggle when clamping a tall reveal at the top inset. */
export const DISCLOSURE_REVEAL_TOP_MARGIN_PX = 8;

const REVEAL_DELTA_THRESHOLD_PX = 0.5;
const ANIMATION_SAFETY_TIMEOUT_MS = 650;
const CLAMP_SETTLE_TIMEOUT_MS = 350;
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);
const CLIPPING_OVERFLOW = new Set(['hidden', 'clip']);
const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
const NOOP = () => {};

export type DisclosureRevealMetrics = {
  containerTop: number;
  containerBottom: number;
  topInset: number;
  bottomInset: number;
  toggleTop: number;
  expandedBottom: number;
  topMargin?: number;
};

/**
 * Downward scroll delta to bring `expandedBottom` above `visibleBottom`, clamped so `toggleTop`
 * never scrolls above `visibleTop + topMargin` and never scrolls upward.
 */
export const computeDisclosureRevealDelta = ({
  containerTop,
  containerBottom,
  topInset,
  bottomInset,
  toggleTop,
  expandedBottom,
  topMargin = DISCLOSURE_REVEAL_TOP_MARGIN_PX,
}: DisclosureRevealMetrics): number => {
  const visibleTop = containerTop + topInset;
  const visibleBottom = containerBottom - bottomInset;
  if (expandedBottom <= visibleBottom) return 0;
  return Math.max(0, Math.min(expandedBottom - visibleBottom, toggleTop - visibleTop - topMargin));
};

/** First ancestor whose computed `overflowY` creates a vertical scroll container. */
export const findScrollContainer = (element: HTMLElement): HTMLElement | null => {
  if (typeof getComputedStyle !== 'function') return null;
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (SCROLLABLE_OVERFLOW.has(getComputedStyle(node).overflowY)) return node;
  }
  return null;
};

/**
 * Max visible bottom edge across connected, non-empty targets, clamped against any `hidden`/`clip`
 * ancestor between each target and `scroller`.
 */
export const measureExpandedBottom = (
  targets: readonly HTMLElement[],
  scroller: HTMLElement
): number | undefined => {
  if (typeof getComputedStyle !== 'function') return undefined;
  let maxBottom: number | undefined;
  for (const target of targets) {
    if (!target.isConnected) continue;
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) continue;
    let bottom = rect.bottom;
    for (
      let ancestor = target.parentElement;
      ancestor && ancestor !== scroller;
      ancestor = ancestor.parentElement
    ) {
      if (CLIPPING_OVERFLOW.has(getComputedStyle(ancestor).overflowY)) {
        bottom = Math.min(bottom, ancestor.getBoundingClientRect().bottom);
      }
    }
    if (bottom > rect.top && (maxBottom === undefined || bottom > maxBottom)) maxBottom = bottom;
  }
  return maxBottom;
};

const activeReveals = new WeakMap<HTMLElement, () => void>();

/** Whether a disclosure reveal session is currently active on `scroller`. */
export const isDisclosureRevealActive = (scroller: HTMLElement): boolean =>
  activeReveals.has(scroller);

export type ScheduleDisclosureRevealOptions = {
  toggle: HTMLElement;
  getTargets: () => readonly HTMLElement[];
  animatedElement?: HTMLElement;
  topMargin?: number;
};

/**
 * Reveals an opened disclosure in its nearest vertical scroll container without scrolling the
 * toggle past the top inset, tracking opening animations and delayed virtualizer height commits.
 */
export const scheduleDisclosureReveal = ({
  toggle,
  getTargets,
  animatedElement,
  topMargin,
}: ScheduleDisclosureRevealOptions): (() => void) => {
  if (!toggle.isConnected || typeof requestAnimationFrame !== 'function') return NOOP;
  const scroller = findScrollContainer(toggle);
  if (!scroller) return NOOP;

  activeReveals.get(scroller)?.();

  let active = true;
  let waitingForAnimation = animatedElement !== undefined;
  let frameId: number | undefined;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined;
  let onAnimationDone: ((event: Event) => void) | undefined;

  const cleanup = () => {
    if (!active) return;
    active = false;
    if (activeReveals.get(scroller) === cleanup) activeReveals.delete(scroller);
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    clearTimeout(animationTimer);
    clearTimeout(settleTimer);
    frameId = undefined;
    animationTimer = undefined;
    settleTimer = undefined;
    observer?.disconnect();
    CANCEL_EVENTS.forEach((name) => scroller.removeEventListener(name, cleanup));
    if (animatedElement && onAnimationDone) {
      animatedElement.removeEventListener('animationend', onAnimationDone);
      animatedElement.removeEventListener('animationcancel', onAnimationDone);
    }
  };

  const step = () => {
    frameId = undefined;
    if (!active) return;
    if (!toggle.isConnected) {
      cleanup();
      return;
    }
    const targets = getTargets();
    const expandedBottom =
      targets.length > 0 ? measureExpandedBottom(targets, scroller) : undefined;
    if (expandedBottom === undefined) {
      if (!waitingForAnimation && settleTimer === undefined) cleanup();
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const { top: topInset, bottom: bottomInset } = readScrollPadding(scroller);
    const delta = computeDisclosureRevealDelta({
      containerTop: scrollerRect.top,
      containerBottom: scrollerRect.bottom,
      topInset,
      bottomInset,
      toggleTop: toggle.getBoundingClientRect().top,
      expandedBottom,
      topMargin,
    });
    let clamped = false;
    if (delta > REVEAL_DELTA_THRESHOLD_PX) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + delta;
      clamped = delta - (scroller.scrollTop - before) > REVEAL_DELTA_THRESHOLD_PX;
    }
    if (waitingForAnimation) return;
    if (delta <= REVEAL_DELTA_THRESHOLD_PX || !clamped) cleanup();
    else if (settleTimer === undefined) settleTimer = setTimeout(cleanup, CLAMP_SETTLE_TIMEOUT_MS);
  };

  const scheduleStep = () => {
    if (active && frameId === undefined) frameId = requestAnimationFrame(step);
  };

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => scheduleStep());
    const observed = new Set<Element>();
    for (const el of [
      animatedElement,
      scroller.querySelector('[data-timeline-rows]'),
      scroller.firstElementChild,
    ]) {
      if (el && !observed.has(el)) {
        observed.add(el);
        observer.observe(el);
      }
    }
  }

  activeReveals.set(scroller, cleanup);
  CANCEL_EVENTS.forEach((name) => scroller.addEventListener(name, cleanup, { passive: true }));

  if (animatedElement) {
    const finishAnimation = () => {
      if (!active || !waitingForAnimation) return;
      waitingForAnimation = false;
      clearTimeout(animationTimer);
      animationTimer = undefined;
      scheduleStep();
    };
    onAnimationDone = (event: Event) => {
      if (event.target === animatedElement) finishAnimation();
    };
    animatedElement.addEventListener('animationend', onAnimationDone);
    animatedElement.addEventListener('animationcancel', onAnimationDone);
    animationTimer = setTimeout(finishAnimation, ANIMATION_SAFETY_TIMEOUT_MS);
  }

  scheduleStep();
  return cleanup;
};

/** Tracks connected DOM targets registered through a callback ref. */
export const useRevealTargets = () => {
  const targetsRef = useRef<Set<HTMLElement>>(new Set());
  const register = useCallback((node: HTMLElement | null) => {
    if (!node) return undefined;
    const targets = targetsRef.current;
    targets.add(node);
    return () => {
      targets.delete(node);
    };
  }, []);
  const getTargets = useCallback(() => {
    const connected: HTMLElement[] = [];
    targetsRef.current.forEach((node) => {
      if (node.isConnected) connected.push(node);
      else targetsRef.current.delete(node);
    });
    return connected;
  }, []);
  return { register, getTargets };
};

type ElementSource = RefObject<HTMLElement | null> | (() => HTMLElement | null);
type TargetsSource = RefObject<HTMLElement | null> | (() => readonly HTMLElement[]);

const readElement = (src: ElementSource | undefined): HTMLElement | null =>
  !src ? null : typeof src === 'function' ? src() : src.current;

const readTargets = (src: TargetsSource): readonly HTMLElement[] =>
  typeof src === 'function' ? src() : src.current ? [src.current] : [];

/**
 * Schedules a clamped reveal when `open` becomes true after an explicit user action calls the
 * returned `armReveal` function. Initial mount, remounts, expand-all and collapse never scroll.
 */
export const useRevealOnOpen = (
  open: boolean,
  toggle: ElementSource,
  targets: TargetsSource,
  animated?: ElementSource
): (() => void) => {
  const armedRef = useRef(false);
  const latestRef = useRef({ toggle, targets, animated });
  latestRef.current = { toggle, targets, animated };

  const armReveal = useCallback(() => {
    armedRef.current = true;
  }, []);

  useEffect(() => {
    if (!open || !armedRef.current) {
      armedRef.current = false;
      return undefined;
    }
    armedRef.current = false;
    const toggleEl = readElement(latestRef.current.toggle);
    if (!toggleEl) return undefined;
    return scheduleDisclosureReveal({
      toggle: toggleEl,
      getTargets: () => readTargets(latestRef.current.targets),
      animatedElement: readElement(latestRef.current.animated) ?? undefined,
    });
  }, [open]);

  return armReveal;
};

/**
 * Arms clamped reveal on native `<details>` only when the reader activates `<summary>` from a
 * closed state. Initial `defaultOpen` and collapse never scroll.
 */
export const useDetailsRevealOnOpen = () => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const armedRef = useRef(false);
  const cancelRef = useRef<(() => void) | undefined>(undefined);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);

  const arm = useCallback(() => {
    const details = detailsRef.current;
    if (!details) return;
    if (details.open) {
      armedRef.current = false;
      cancel();
    } else {
      armedRef.current = true;
    }
  }, [cancel]);

  const onSummaryKeyDown = useCallback(
    (event: { key: string; repeat?: boolean }) => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) arm();
    },
    [arm]
  );

  const onToggle = useCallback(() => {
    const wasArmed = armedRef.current;
    armedRef.current = false;
    cancel();
    const details = detailsRef.current;
    const summary = summaryRef.current ?? details?.querySelector('summary');
    if (wasArmed && details?.open && summary) {
      cancelRef.current = scheduleDisclosureReveal({
        toggle: summary,
        getTargets: () => (detailsRef.current ? [detailsRef.current] : []),
      });
    }
  }, [cancel]);

  return {
    detailsRef,
    onToggle,
    summaryProps: { ref: summaryRef, onClick: arm, onKeyDown: onSummaryKeyDown },
  };
};
