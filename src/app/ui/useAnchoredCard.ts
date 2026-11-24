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

const isTriggerGone = (trigger: HTMLElement | null | undefined): boolean =>
  !trigger?.isConnected || trigger.getClientRects().length === 0;

const getMutationRoot = (trigger: HTMLElement | null | undefined): Node | null => {
  if (trigger instanceof Node) {
    const root = trigger.getRootNode();
    if (root instanceof Document) return root.body ?? root.documentElement;
    if (root instanceof ShadowRoot) return root;
  }
  return typeof document !== 'undefined' ? (document.body ?? document.documentElement) : null;
};

const isPopupOwnMutation = (
  record: MutationRecord,
  root: Node | null,
  content: HTMLElement | null | undefined,
  trigger: HTMLElement | null | undefined
): boolean => {
  if (record.type !== 'attributes') return false;
  const { target } = record;
  if (target === root) return false;
  if (trigger instanceof Node && (target === trigger || target.contains(trigger))) return false;
  if (content instanceof Node && (content.contains(target) || target.contains(content))) {
    return true;
  }
  return target instanceof Element && target.closest('[data-popout]') !== null;
};

/**
 * Follow a popup through layout changes without polling while idle. A getter is re-read on
 * scroll, viewport resize, element resize, resource load, and DOM mutations so remounted triggers
 * stay tracked.
 */
export function useLiveAnchor(
  opener: HTMLElement | (() => HTMLElement | null) | undefined,
  onGone?: () => void,
  contentRef?: RefObject<HTMLElement | null>
): RectCords | undefined {
  const [anchor, setAnchor] = useState<RectCords>();
  const syncObservedRef = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    if (!opener) {
      syncObservedRef.current = undefined;
      setAnchor(undefined);
      return undefined;
    }

    const getTrigger = () => (typeof opener === 'function' ? opener() : opener);

    let disposed = false;
    let frame = 0;
    let rect: RectCords | undefined;
    let contentSize: string | undefined;
    let trackedTrigger: HTMLElement | null | undefined;
    let trackedContent: HTMLElement | null | undefined;
    let mutationRoot: Node | null = null;

    const cancelFrame = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => schedule());
    if (resizeObserver && document.documentElement instanceof Element) {
      resizeObserver.observe(document.documentElement);
    }

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver((records) => {
            const trigger = getTrigger();
            const content = contentRef?.current;
            if (
              records.some((record) => !isPopupOwnMutation(record, mutationRoot, content, trigger))
            ) {
              schedule();
            }
          });

    const swapObserved = (
      prev: HTMLElement | null | undefined,
      next: HTMLElement | null | undefined,
      other: HTMLElement | null | undefined
    ) => {
      if (!resizeObserver || prev === next) return;
      if (
        prev instanceof Element &&
        prev !== other &&
        prev !== document.documentElement &&
        typeof resizeObserver.unobserve === 'function'
      ) {
        resizeObserver.unobserve(prev);
      }
      if (next instanceof Element) {
        resizeObserver.observe(next);
      }
    };

    const syncObserved = (scheduleOnTriggerChange: boolean) => {
      const trigger = getTrigger();
      const content = contentRef?.current;
      const triggerChanged = trigger !== trackedTrigger;
      const contentChanged = content !== trackedContent;

      if (contentSize === undefined && content) {
        const box = content.getBoundingClientRect();
        contentSize = `${box.width}x${box.height}`;
      }

      if (mutationObserver && (!mutationRoot || triggerChanged)) {
        const nextRoot = getMutationRoot(trigger);
        if (nextRoot !== mutationRoot) {
          mutationObserver.disconnect();
          mutationRoot = nextRoot;
          if (mutationRoot) {
            mutationObserver.observe(mutationRoot, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'class', 'hidden'],
              characterData: true,
            });
          }
        }
      }

      if (triggerChanged) {
        swapObserved(trackedTrigger, trigger, trackedContent);
        trackedTrigger = trigger;
      }
      if (contentChanged) {
        swapObserved(trackedContent, content, trackedTrigger);
        trackedContent = content;
      }

      if (scheduleOnTriggerChange && triggerChanged) {
        schedule();
      }
    };

    const measure = () => {
      if (disposed) return;
      const trigger = getTrigger();
      if (onGone && isTriggerGone(trigger)) {
        cancelFrame();
        onGone();
        return;
      }
      syncObserved(false);
      const next = trigger?.getBoundingClientRect();
      const box = contentRef?.current?.getBoundingClientRect();
      const size = box && `${box.width}x${box.height}`;
      const resized = size !== contentSize;
      contentSize = size;
      if (next) {
        const { x, y, width, height } = next;
        // Keep the last position on zero measurements (e.g. a hidden timeline trigger).
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
    };

    const schedule = () => {
      if (disposed || frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('load', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule, { passive: true });
    viewport?.addEventListener('scroll', schedule, { passive: true });

    syncObservedRef.current = () => syncObserved(true);
    measure();

    return () => {
      disposed = true;
      syncObservedRef.current = undefined;
      cancelFrame();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('load', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [opener, onGone, contentRef]);

  // Attach ResizeObserver once a newly opened card mounts under `contentRef`, or when a trigger
  // remounts during a render while the popup stays open.
  useLayoutEffect(() => {
    if (opener) syncObservedRef.current?.();
  });

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
  const closeTimer = useRef<number>(undefined);

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
