import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { RectCords } from 'folds';
import { tabFromCardToOpener } from '../lib/overlayFocus';

/** How a card came up: a mouse resting on its trigger, keyboard focus, or a click or tap. */
type CardMode = 'hover' | 'focus' | 'pinned';

/** Follow a popup through layout changes. A getter is read each frame to follow remounted triggers. */
export function useLiveAnchor(
  opener: HTMLElement | (() => HTMLElement | null) | undefined,
  onGone?: () => void,
  contentRef?: RefObject<HTMLElement>
): RectCords | undefined {
  const [anchor, setAnchor] = useState<RectCords>();
  useLayoutEffect(() => {
    if (!opener) {
      setAnchor(undefined);
      return undefined;
    }
    let frame = 0;
    let rect: RectCords | undefined;
    let contentSize: string | undefined;
    const follow = () => {
      const trigger = typeof opener === 'function' ? opener() : opener;
      if (onGone && !trigger?.isConnected) {
        onGone();
        return;
      }
      const next = trigger?.getBoundingClientRect();
      const box = contentRef?.current?.getBoundingClientRect();
      const size = box && `${box.width}x${box.height}`;
      const resized = size !== contentSize;
      contentSize = size;
      if (next) {
        const { x, y, width, height } = next;
        // A hidden opener measures all zeros. Keep the last position until it is shown again.
        if (
          !rect ||
          ((x || y || width || height) &&
            (resized ||
              x !== rect.x ||
              y !== rect.y ||
              width !== rect.width ||
              height !== rect.height))
        ) {
          rect = next;
          setAnchor(next);
        }
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [opener, onGone, contentRef]);
  return opener ? anchor : undefined;
}

/**
 * A card a button opens, anchored to it in a PopOut: the open state, and while it is open Escape,
 * Tab in the card, a press outside and following the button as the page moves. `closeDelayMs` is
 * how long a hover card waits for the mouse to reach it, or come back, before closing; without it
 * the mouse leaving closes it at once. Attach `triggerRef` to the button and `cardRef` to a card
 * that takes the pointer or focus.
 */
export function useAnchoredCard(closeDelayMs = 0) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<CardMode>();
  const closeTimer = useRef<number>();

  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), []);
  const close = useCallback(() => {
    cancelClose();
    setMode(undefined);
  }, [cancelClose]);
  const show = useCallback(
    (mode: CardMode) => {
      cancelClose();
      if (triggerRef.current) setMode(mode);
    },
    [cancelClose]
  );
  const getTrigger = useCallback(() => triggerRef.current, []);
  const anchor = useLiveAnchor(mode && getTrigger, undefined, cardRef);
  const open = mode && anchor && { mode, anchor };
  // Focus reached the card: the mouse leaving must not take it, nor a close the mouse already
  // started, or the focus in it would drop to the page.
  const pin = () => {
    cancelClose();
    setMode((current) => current && 'pinned');
  };
  const toggle = () => (open?.mode === 'pinned' ? close() : show('pinned'));

  // A card the mouse opened stays while the mouse is on the trigger or on the card, so it can be
  // read and selected (WCAG 1.4.13): leaving either closes it only after a moment without the other.
  // Spread on both; the card is only there while open.
  const hover = {
    onPointerEnter: (evt: PointerEvent) => {
      if (evt.pointerType !== 'mouse') return;
      cancelClose();
      if (!open) show('hover');
    },
    onPointerLeave: (evt: PointerEvent) => {
      if (evt.pointerType !== 'mouse' || open?.mode !== 'hover') return;
      if (!closeDelayMs) {
        close();
        return;
      }
      cancelClose();
      closeTimer.current = window.setTimeout(() => {
        setMode((current) => (current === 'hover' ? undefined : current));
      }, closeDelayMs);
    },
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // A press in the card, to select its text, takes focus from the trigger into it: only focus that
  // leaves both closes the card.
  const onFocusLeave = (evt: FocusEvent) => {
    const next = evt.relatedTarget;
    const within = (element: Element | null) => next instanceof Node && !!element?.contains(next);
    if (!within(triggerRef.current) && !within(cardRef.current)) close();
  };

  const isOpen = !!open;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (evt: KeyboardEvent) => {
      const inCard = !!cardRef.current?.contains(document.activeElement);
      // The card lives in the body: Tab in it goes on from the trigger, where it opened. Only a key
      // pressed in the card: a trigger may itself send Tab into the card, and focus is there by now.
      const fromCard = evt.target instanceof Node && !!cardRef.current?.contains(evt.target);
      if (fromCard) tabFromCardToOpener(evt, triggerRef.current);
      if (evt.key !== 'Escape') return;
      // Focus in the card would fall to the page once it is gone, so it goes back to the trigger,
      // and the room's Escape (focus the composer, ShortcutRoot on the window), which skips a key
      // whose default was prevented, must not take it from there. With focus elsewhere that
      // Escape still runs.
      if (inCard) {
        evt.preventDefault();
        triggerRef.current?.focus();
      }
      close();
    };
    // A tap on iOS focuses no button, so no blur comes when the next tap lands elsewhere.
    const onPointerDown = (evt: Event) => {
      const target = evt.target as Node;
      if (!triggerRef.current?.contains(target) && !cardRef.current?.contains(target)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOpen, close]);

  return { open, triggerRef, cardRef, show, close, pin, toggle, hover, onFocusLeave };
}
