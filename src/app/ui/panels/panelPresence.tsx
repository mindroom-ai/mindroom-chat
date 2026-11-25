import {
  createContext,
  type MutableRefObject,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** How long a panel takes to open, close or trade places, on the Standard motion curve. */
export const PANEL_MOTION_MS = 220;
export const PANEL_MOTION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Where a panel is in its life: `shown` (there from the first render, so it does not move in),
 * `enter` (just opened), `swap` (took the place of another panel) or `exit` (closing; it stays
 * mounted until it calls `done`).
 */
export type PanelPhase = 'shown' | 'enter' | 'swap' | 'exit';

/**
 * What `register()` gives a moving panel: called, it unregisters; its `done` is the place's `done`
 * while registered, and ends nothing after. A motion that ends after its panel has gone (another
 * panel took the place, which may close in turn) so leaves the next panel's exit alone. Call it
 * only for the exit you are animating; a kept `done` from an earlier exit is not supported.
 */
export type PanelRegistration = (() => void) & { done: () => void };

export type PanelPresence = {
  phase: PanelPhase;
  /** The closing panel has finished moving out (or does not move), so it may go. */
  done: () => void;
  /**
   * A moving panel announces itself while mounted; it then calls the registration's `done` when it
   * has closed. One that goes first while it closes (a failure took its place) lets the place end
   * its exit.
   */
  register: () => PanelRegistration;
  /**
   * The width the last panel in this place had when it left, which a swapped-in panel starts from:
   * the room's own panels set it as they go, and a moving panel may too.
   */
  lastWidth: MutableRefObject<number | undefined>;
};

const PanelPresenceContext = createContext<PanelPresence | undefined>(undefined);

/** The phase of the panel slot around this component; none outside a slot. */
export const usePanelPresence = (): PanelPresence | undefined => useContext(PanelPresenceContext);

type Slot = {
  /** The key of the panel asked for, or undefined while none is. */
  key?: string;
  /** The key of the panel on screen, which stays while it closes. */
  shownKey?: string;
  phase: PanelPhase;
};

/** Whether the panel on screen is closing: none is asked for, and it has not yet gone. */
const isClosing = (slot: Slot) => slot.key === undefined && slot.shownKey !== undefined;

/**
 * One place for a panel beside the content that opens and closes in motion. Pass the panel to
 * show (with a key naming which one) or undefined; the slot keeps a closing panel mounted until it
 * has moved out, and tells a new panel whether it opens, replaces another, or was there from the
 * start. With `opening`, a panel there from the start opens all the same: the place came with the
 * panel that was just opened (a new page with the navigation the same click opened). Returns what
 * to render in that place, or undefined when nothing is there.
 */
export function usePanelSlot(
  panel: ReactElement | undefined,
  opening = false
): ReactElement | undefined {
  const key = panel ? String(panel.key) : undefined;
  const [slot, setSlot] = useState<Slot>({
    key,
    shownKey: key,
    phase: opening && panel ? 'enter' : 'shown',
  });
  if (slot.key !== key) {
    let phase: PanelPhase = 'exit';
    if (key !== undefined) {
      phase = slot.shownKey === undefined || slot.shownKey === key ? 'enter' : 'swap';
    }
    setSlot({ key, shownKey: key ?? slot.shownKey, phase });
  }
  const lastPanel = useRef(panel);
  useLayoutEffect(() => {
    if (panel) lastPanel.current = panel;
  });
  const lastWidth = useRef<number>(undefined);
  /** Whether the panel was closing at the last commit, until `done`. */
  const closingRef = useRef(false);
  const done = useCallback(() => {
    closingRef.current = false;
    // Once the panel has gone, a later `done` (from its last mover as it goes) changes nothing.
    setSlot((current) => (isClosing(current) ? { phase: 'shown' } : current));
  }, []);
  const movers = useRef(0);
  const register = useCallback(() => {
    movers.current += 1;
    let registered = true;
    const unregister = () => {
      registered = false;
      movers.current -= 1;
      // The last moving panel went while it closed without calling `done` (a failure took its
      // place), so nothing would end the exit.
      if (movers.current === 0 && closingRef.current) done();
    };
    return Object.assign(unregister, {
      done: () => {
        if (registered) done();
      },
    });
  }, [done]);
  // Runs after the panel's own effects: with no moving panel inside (a canvas without its
  // content, or other content), what closes leaves at once.
  const closing = isClosing(slot);
  useLayoutEffect(() => {
    closingRef.current = closing;
    if (closing && movers.current === 0) done();
  }, [closing, done]);
  const value = useMemo(
    () => ({ phase: slot.phase, done, register, lastWidth }),
    [slot.phase, done, register]
  );
  const shown = panel ?? (slot.shownKey === undefined ? undefined : lastPanel.current);
  return shown && <PanelPresenceContext value={value}>{shown}</PanelPresenceContext>;
}

/**
 * The form a panel shows in, such as beside the content or over it, given the form the layout
 * asks for now. A closing panel keeps the form it had while it was open: when the layout changes
 * as it closes (a window narrowed to a phone, where the panel would lie over the content), it does
 * not move out in the new form, which would open over the content (and take the focus) only to
 * close, but goes at once.
 */
export function usePanelForm<Form>(form: Form): Form {
  const presence = usePanelPresence();
  const closing = presence?.phase === 'exit';
  const [openForm, setOpenForm] = useState(form);
  if (!closing && !Object.is(openForm, form)) setOpenForm(form);
  const changed = closing && !Object.is(openForm, form);
  const done = presence?.done;
  useLayoutEffect(() => {
    if (changed) done?.();
  }, [changed, done]);
  return closing ? openForm : form;
}

/** A panel's width and the gap it adds beside itself, both in pixels. */
export type PanelSize = { width: number; gap: number };

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reads the panel's laid-out width when DOM geometry is available (0 in non-DOM test renderers). */
export const panelRenderedWidth = (panel: HTMLElement | null | undefined): number =>
  typeof panel?.getBoundingClientRect === 'function' ? panel.getBoundingClientRect().width : 0;

/** Measures the full target card width of the row for snap-to-fill previews and restore glides. */
export const measureFullRowWidth = (parent: HTMLElement): number => {
  const style = getComputedStyle(parent);
  const endPad = Number.parseFloat(style.paddingInlineEnd) || 0;
  if (endPad > 0) return Math.max(0, parent.clientWidth - 2 * endPad);
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  return Math.max(0, parent.clientWidth - padding);
};

const clearFillGlide = (panel: HTMLElement | null | undefined): void => {
  if (panel?.dataset) delete panel.dataset.fillGlide;
};

/** Cancels any active panel animation and clears transient restore-glide styling. */
export const cancelPanelMotion = (
  panel: HTMLElement | null,
  motionRef: MutableRefObject<Animation | undefined>
): void => {
  motionRef.current?.cancel();
  motionRef.current = undefined;
  clearFillGlide(panel);
};

/**
 * Finds the nearest ancestor box that participates in layout (skipping `display: contents`
 * wrappers), for measuring row width, observing resizes, and reading the row's end gap.
 */
export const layoutParentOf = (element: HTMLElement | null | undefined): HTMLElement | null => {
  let parent = element?.parentElement ?? null;
  while (
    parent &&
    (parent.style?.display === 'contents' ||
      (typeof getComputedStyle === 'function' &&
        typeof Element !== 'undefined' &&
        parent instanceof Element &&
        getComputedStyle(parent).display === 'contents'))
  ) {
    parent = parent.parentElement;
  }
  return parent;
};

/**
 * The gap a panel at the end of a row brings: the room leaves room for it at its end only while
 * the panel is there, so a panel moving in or out carries that gap as a negative start margin.
 */
export const panelGap = (panel: HTMLElement, side: 'start' | 'end'): number => {
  if (side !== 'end') return 0;
  const parent = layoutParentOf(panel);
  if (!parent) return 0;
  return Number.parseFloat(getComputedStyle(parent).paddingInlineEnd) || 0;
};

/** Where a moving panel is now. */
export const currentPanelSize = (panel: HTMLElement): PanelSize => ({
  width: panel.getBoundingClientRect().width,
  gap: -(Number.parseFloat(getComputedStyle(panel).marginInlineStart) || 0),
});

/**
 * Moves a panel from one size to another: the browser animates its width (and the gap, as a start
 * margin), so React renders nothing per frame. `hold` keeps the end size after the motion, for a
 * panel about to leave. A panel that stays moves toward its own width on every frame rather than
 * to `to`, so it arrives where it settles also when that changes on the way: a panel that just
 * mounted measures the room beside it only after its motion has started. Returns undefined, and
 * moves nothing, under reduced motion or without the Web Animations API.
 */
export const animatePanel = (
  panel: HTMLElement,
  from: PanelSize,
  to: PanelSize,
  hold: boolean
): Animation | undefined => {
  if (typeof panel.animate !== 'function' || prefersReducedMotion()) return undefined;
  const frame = ({ width, gap }: PanelSize): Keyframe => ({
    width: `${width}px`,
    marginInlineStart: `${-gap}px`,
  });
  // Without a last keyframe the motion ends at the panel's width and gap as styled.
  const keyframes = hold ? [frame(from), frame(to)] : [{ ...frame(from), offset: 0 }];
  return panel.animate(keyframes, {
    duration: PANEL_MOTION_MS,
    easing: PANEL_MOTION_EASING,
    fill: hold ? 'forwards' : 'none',
  });
};

/**
 * Glides a panel smoothly from its beside width to full width. For an end-side panel, the start
 * margin shrinks alongside the width growth so its start edge glides across the row instead of
 * jumping to the far wall first, while start padding eases in from 0 so floating cards keep the
 * exact same rendered card width on frame 0.
 */
export const animatePanelFill = (
  panel: HTMLElement,
  fromWidth: number,
  toWidth: number,
  side: 'start' | 'end'
): Animation | undefined => {
  if (typeof panel.animate !== 'function' || prefersReducedMotion()) return undefined;
  const startPad = Number.parseFloat(getComputedStyle(panel).paddingInlineStart) || 0;
  const keyframes: Keyframe[] =
    side === 'end'
      ? [
          {
            width: `${fromWidth}px`,
            marginInlineStart: `${toWidth - fromWidth}px`,
            paddingInlineStart: '0px',
          },
          {
            width: `${toWidth}px`,
            marginInlineStart: '0px',
            paddingInlineStart: `${startPad}px`,
          },
        ]
      : [
          { width: `${fromWidth}px`, paddingInlineStart: '0px' },
          { width: `${toWidth}px`, paddingInlineStart: `${startPad}px` },
        ];
  return panel.animate(keyframes, {
    duration: PANEL_MOTION_MS,
    easing: PANEL_MOTION_EASING,
    fill: 'none',
  });
};

/** How long `data-just-filled` stays on after landing in full width to drive the Fill pulse. */
const FILL_PULSE_MS = 750;

/**
 * Smoothly glides a desktop panel between beside and filled layouts, sets `data-fill-glide` while
 * restoring so content tracks the live animated width, and pulses `data-just-filled` once the fill
 * glide lands (skipped under reduced motion, on initial mount, while exiting, or when unfolding
 * straight from folded).
 */
export function usePanelFillMotion({
  panelRef,
  motionRef,
  full,
  folded,
  mobile,
  passthrough,
  phase,
  side,
  width,
}: {
  panelRef: MutableRefObject<HTMLDivElement | null>;
  motionRef: MutableRefObject<Animation | undefined>;
  full: boolean;
  folded: boolean;
  mobile: boolean;
  passthrough: boolean;
  phase: PanelPhase;
  side: 'start' | 'end';
  width: number;
}): boolean {
  const prevFullRef = useRef(full);
  const prevFoldedRef = useRef(folded);
  const prevWidthRef = useRef(width);
  const transitionRef = useRef(0);
  const [justFilled, setJustFilled] = useState(false);

  // Track the latest beside width from React state (no DOM reads or forced layouts while dragging).
  useLayoutEffect(() => {
    if (!full && !folded && !passthrough) prevWidthRef.current = width;
  }, [folded, full, passthrough, width]);

  // Clear pending landing callbacks and transient restore-glide styling on unmount.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      transitionRef.current += 1;
      clearFillGlide(panel);
    };
  }, [panelRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const wasFull = prevFullRef.current;
    const wasFolded = prevFoldedRef.current;
    prevFullRef.current = full;
    prevFoldedRef.current = folded;
    if (!panel) return;

    if (folded || passthrough || phase === 'exit') {
      transitionRef.current += 1;
      if (phase !== 'exit' && wasFull !== full) cancelPanelMotion(panel, motionRef);
      else clearFillGlide(panel);
      setJustFilled(false);
      return;
    }

    if (wasFull === full) return;

    transitionRef.current += 1;
    const token = transitionRef.current;
    const wasRunning = motionRef.current?.playState === 'running';
    let runningWidth = 0;
    if (wasRunning) {
      // Interrupting a Fill glide (full: true -> false): subtract its animated start padding for
      // the live card width. Interrupting a Shrink glide (full: false -> true): the running motion
      // had 0 start padding even though `[data-filled]` is already applied.
      const runningPad = full
        ? 0
        : Number.parseFloat(getComputedStyle(panel).paddingInlineStart) || 0;
      runningWidth = Math.max(0, panelRenderedWidth(panel) - runningPad);
    }
    cancelPanelMotion(panel, motionRef);

    // Do not glide or pulse when unfolding straight from folded.
    if (wasFolded) {
      setJustFilled(false);
      return;
    }

    if (full) {
      setJustFilled(false);
      const toWidth = panelRenderedWidth(panel);
      const recordedFrom = runningWidth > 0 ? runningWidth : prevWidthRef.current;
      const fromWidth = Math.min(recordedFrom, toWidth);
      const motion =
        !mobile && toWidth - fromWidth > 1
          ? animatePanelFill(panel, fromWidth, toWidth, side)
          : undefined;
      motionRef.current = motion;
      if (prefersReducedMotion()) return;
      if (typeof motion?.finished?.then === 'function') {
        void motion.finished.then(
          () => {
            if (transitionRef.current === token) setJustFilled(true);
          },
          () => undefined
        );
      } else {
        setJustFilled(true);
      }
      return;
    }

    setJustFilled(false);
    const parent = layoutParentOf(panel);
    const fromWidth =
      runningWidth > 0 ? runningWidth : parent ? measureFullRowWidth(parent) : 0;
    if (!mobile && fromWidth > 0 && Math.abs(fromWidth - width) > 1) {
      const motion = animatePanel(panel, { width: fromWidth, gap: 0 }, { width, gap: 0 }, false);
      motionRef.current = motion;
      if (typeof motion?.finished?.then === 'function') {
        if (panel.dataset) panel.dataset.fillGlide = 'true';
        const clearGlide = () => {
          if (transitionRef.current === token && motionRef.current === motion) {
            clearFillGlide(panel);
          }
        };
        void motion.finished.then(clearGlide, clearGlide);
      }
    }
  }, [folded, full, mobile, motionRef, panelRef, passthrough, phase, side, width]);

  useEffect(() => {
    if (!justFilled) return undefined;
    const timer = setTimeout(() => setJustFilled(false), FILL_PULSE_MS);
    return () => clearTimeout(timer);
  }, [justFilled]);

  return justFilled;
}
