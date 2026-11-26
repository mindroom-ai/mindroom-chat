import {
  useLayoutEffect,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { tabbablesOf } from '../../lib/overlayFocus';

/** The button of a Compact room or Space overview card that opens its thread. */
const VIEW_SELECTOR = '[data-compact-room-view], [data-space-threads-list]';
const CARD_SELECTOR =
  '[data-compact-room-view] [data-thread-root-id], [data-space-threads-list] [data-thread-root-id]';

/** The full keyboard order and focus command for each mounted Compact scroller. */
export const compactCardNavigation = new WeakMap<
  Element,
  {
    ids: readonly string[];
    idOf?: (card: HTMLElement) => string | undefined;
    focus: (id: string | undefined, last?: boolean) => boolean;
  }
>();

export const navigationIn = (root: HTMLElement | null) => {
  const view = root?.closest(VIEW_SELECTOR) ?? root?.querySelector(VIEW_SELECTOR);
  return view ? compactCardNavigation.get(view) : undefined;
};

/**
 * Marks a card the keys focused. A browser shows `:focus-visible` on a script's focus only after
 * a plain key: after a chord (⌘ or Ctrl, Alt and an arrow) that follows a click it shows none, so
 * the card's styles draw the ring for this mark as well.
 */
export const KEY_FOCUS_ATTRIBUTE = 'data-key-focus';

/** Whether `element` currently shows keyboard focus (scripted key focus or `:focus-visible`). */
export const isKeyboardFocus = (element: Element): boolean => {
  if (element.hasAttribute(KEY_FOCUS_ATTRIBUTE)) return true;
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
};

/** Moves the keyboard's focus to `card`, and shows it there. False without a card. */
export const focusCompactCard = (card: HTMLElement | undefined): boolean => {
  if (!card) return false;
  card.setAttribute(KEY_FOCUS_ATTRIBUTE, '');
  // Until the focus moves on: a window that loses the focus blurs the card too, which keeps it.
  const onBlur = () => {
    if (card.ownerDocument.activeElement === card) return;
    card.removeAttribute(KEY_FOCUS_ATTRIBUTE);
    card.removeEventListener('blur', onBlur);
  };
  card.addEventListener('blur', onBlur);
  card.focus();
  return true;
};

/** The Compact cards under `root`, in the order they show; not one that is fading out (inert). */
export const compactCardsIn = (root: ParentNode | null | undefined): HTMLElement[] =>
  Array.from(root?.querySelectorAll<HTMLElement>(CARD_SELECTOR) ?? []).filter(
    (card) => !card.closest('[inert]')
  );

/** The card that has the keyboard's focus, under `root` when one is given. */
export const focusedCompactCard = (root?: Node | null): HTMLElement | undefined => {
  if (typeof document === 'undefined' || root === null) return undefined;
  const focused = document.activeElement;
  const card = focused instanceof HTMLElement && focused.matches(CARD_SELECTOR);
  return card && (root === undefined || root.contains(focused)) ? focused : undefined;
};

/** The first card below the floating header, which a card scrolled under it is not. */
const firstCardInView = (cards: readonly HTMLElement[]): HTMLElement | undefined => {
  const view = cards[0]?.closest(VIEW_SELECTOR);
  if (!view) return cards[0];
  const top =
    view.getBoundingClientRect().top + (parseFloat(getComputedStyle(view).scrollPaddingTop) || 0);
  return cards.find((card) => card.getBoundingClientRect().top >= top - 1) ?? cards[0];
};

/** Focuses a logical neighbour, including one outside the mounted window. */
export const focusCardBeside = (
  root: HTMLElement | null,
  id: string | undefined,
  step: -1 | 0 | 1,
  exact = false
): boolean => {
  const navigation = navigationIn(root);
  const index = id === undefined ? -1 : (navigation?.ids.indexOf(id) ?? -1);
  if (navigation && index >= 0) {
    return navigation.focus(navigation.ids[index + step] ?? navigation.ids[index]);
  }
  return exact ? false : focusCompactCard(firstCardInView(compactCardsIn(root)));
};

/**
 * On a focused card, the up and down arrows, Home and End move the focus between the cards. A
 * card's own buttons and every chord keep their keys.
 */
export const handleCardArrowKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const { key, target } = event;
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return;
  const navigation = navigationIn(event.currentTarget);
  const cardId =
    navigation?.idOf?.(target as HTMLElement) ?? (target as HTMLElement).dataset.threadRootId ?? '';
  const at = navigation?.ids.indexOf(cardId) ?? -1;
  if (!navigation || at < 0 || !compactCardsIn(event.currentTarget).includes(target as HTMLElement))
    return;
  event.preventDefault();
  const next = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: navigation.ids.length - 1 }[key];
  navigation.focus(navigation.ids[next]);
};

export type CompactCardFocusIntent = {
  id: string;
  scope: string;
  from: Element | null;
  last?: boolean;
  at: number[];
};

const defaultCardId = (card: HTMLElement): string | undefined => card.dataset.threadRootId;

/** Registers keyboard card navigation on `scrollRef` and focuses offscreen targets once mounted. */
export function useCompactCardNavigation({
  scrollRef,
  ids,
  idOf = defaultCardId,
  scope,
  intent,
  pending,
  setIntent,
  blocked = false,
  targetReady,
  progress,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  ids: readonly string[];
  idOf?: (card: HTMLElement) => string | undefined;
  scope: string;
  intent: CompactCardFocusIntent | undefined;
  pending: CompactCardFocusIntent | undefined;
  setIntent: Dispatch<SetStateAction<CompactCardFocusIntent | undefined>>;
  blocked?: boolean;
  targetReady: boolean;
  progress: { input: number; onWrite?: () => void };
}): void {
  useLayoutEffect(() => {
    const view = scrollRef.current;
    if (!view || typeof document === 'undefined') return undefined;
    // A card's button, or the last control Tab reaches in the card: where Shift+Tab enters it.
    const card = (id: string, last?: boolean) => {
      const button = compactCardsIn(view).find((entry) => idOf(entry) === id);
      const shell = last && button?.closest('[data-scroll-anchor]');
      return (shell && tabbablesOf(shell).at(-1)) || button;
    };
    const at = () => [view.scrollTop, progress.input];
    const focus = (id: string | undefined, last?: boolean) => {
      if (!id) return false;
      if (focusCompactCard(card(id, last))) setIntent(undefined);
      else {
        if (!document.activeElement || document.activeElement === document.body)
          view.focus({ preventScroll: true });
        setIntent({ id, scope, from: document.activeElement, last, at: at() });
      }
      return true;
    };
    compactCardNavigation.set(view, { ids, idOf, focus });
    const active = document.activeElement;
    // A reader whose input scrolled the list since the key keeps the place, as with an address.
    const left = pending && at().every((now, i) => now !== pending.at[i]);
    if (intent && (!pending || left || (active !== pending.from && active !== document.body)))
      setIntent(undefined);
    else if (pending && !blocked && targetReady) {
      focusCompactCard(card(pending.id, pending.last));
      // The focus scrolled the list: the window follows before the target's band is let go.
      progress.onWrite?.();
      setIntent(undefined);
    }
    return () => void compactCardNavigation.delete(view);
  }, [blocked, idOf, ids, intent, pending, progress, scope, scrollRef, setIntent, targetReady]);
}
