import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import type { RectCords } from 'folds';
import { tabFromCardToOpener } from '../lib/overlayFocus';

/** How a card came up: a mouse resting on its trigger, keyboard focus, or a click or tap. */
type CardMode = 'hover' | 'focus' | 'pinned';

type OpenCard = { mode: CardMode; anchor: RectCords };

/** The open card with its anchor at `rect`, the same object while the trigger has not moved. */
const anchoredAt = (current: OpenCard | undefined, rect: RectCords): OpenCard | undefined => {
  if (!current) return current;
  const { x, y, width, height } = current.anchor;
  const moved = rect.x !== x || rect.y !== y || rect.width !== width || rect.height !== height;
  return moved ? { ...current, anchor: rect } : current;
};

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
  const [open, setOpen] = useState<OpenCard>();
  const closeTimer = useRef<number>();

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const close = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setOpen(undefined);
  }, []);
  const show = (mode: CardMode) => {
    cancelClose();
    const trigger = triggerRef.current;
    if (trigger) setOpen({ mode, anchor: trigger.getBoundingClientRect() });
  };
  // Focus reached the card: the mouse leaving must not take it, nor a close the mouse already
  // started, or the focus in it would drop to the page.
  const pin = () => {
    cancelClose();
    setOpen((current) => current && { ...current, mode: 'pinned' });
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
        setOpen((current) => (current?.mode === 'hover' ? undefined : current));
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
    // The card sits at a fixed spot, so it follows the trigger once a frame, whatever moved it: a
    // scroll, the timeline settling as rows arrive, a line showing above it, text above it
    // wrapping, an image loading. A card that changed size is placed again, a new anchor for folds.
    let frame = 0;
    let cardSize = '';
    const follow = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const box = cardRef.current?.getBoundingClientRect();
      const size = box ? `${box.width}x${box.height}` : '';
      const resized = size !== cardSize;
      cardSize = size;
      // A trigger not displayed measures all zeros; the card then stays where it last was.
      const shown = rect && (rect.x || rect.y || rect.width || rect.height);
      if (shown) {
        setOpen((current) =>
          resized && current ? { ...current, anchor: rect } : anchoredAt(current, rect)
        );
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOpen, close]);

  return { open, triggerRef, cardRef, show, close, pin, toggle, hover, onFocusLeave };
}
