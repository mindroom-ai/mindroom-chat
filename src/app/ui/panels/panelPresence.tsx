import {
  createContext,
  type MutableRefObject,
  type ReactElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** How long a panel takes to open, close or trade places, on the Standard motion curve. */
export const PANEL_MOTION_MS = 220;
const PANEL_MOTION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Where a panel is in its life: `shown` (there from the first render, so it does not move in),
 * `enter` (just opened), `swap` (took the place of another panel) or `exit` (closing; it stays
 * mounted until it calls `done`).
 */
export type PanelPhase = 'shown' | 'enter' | 'swap' | 'exit';

export type PanelPresence = {
  phase: PanelPhase;
  /** The closing panel has finished moving out (or does not move), so it may go. */
  done: () => void;
  /**
   * A moving panel announces itself while mounted; it then calls `done` when it has closed. One
   * that goes first while it closes (a failure took its place) lets the place end its exit.
   */
  register: () => () => void;
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
  const lastWidth = useRef<number>();
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
    return () => {
      movers.current -= 1;
      // The last moving panel went while it closed without calling `done` (a failure took its
      // place), so nothing would end the exit.
      if (movers.current === 0 && closingRef.current) done();
    };
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
  return (
    shown && <PanelPresenceContext.Provider value={value}>{shown}</PanelPresenceContext.Provider>
  );
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
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The gap a panel at the end of a row brings: the room leaves room for it at its end only while
 * the panel is there, so a panel moving in or out carries that gap as a negative start margin.
 */
export const panelGap = (panel: HTMLElement, side: 'start' | 'end'): number => {
  const parent = panel.parentElement;
  if (side !== 'end' || !parent) return 0;
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
