import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** The button of a Compact room card (room overview or Thread Board column) that opens its thread. */
const COMPACT_ROOM_CARD_SELECTOR = '[data-compact-room-view] [data-thread-root-id]';
const VIEW_SELECTOR = '[data-compact-room-view], [data-space-threads-list]';
const CARD_SELECTOR = `${COMPACT_ROOM_CARD_SELECTOR}, [data-space-threads-list] [data-thread-root-id]`;

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

const cardKey = (card: HTMLElement, idOf?: (card: HTMLElement) => string | undefined): string =>
  idOf?.(card) ?? card.dataset.threadRootId ?? '';

export const findCompactCard = (root: HTMLElement | null, id: string): HTMLElement | undefined => {
  const idOf = navigationIn(root)?.idOf;
  return compactCardsIn(root).find((card) => cardKey(card, idOf) === id);
};

/** The Compact room card that has the keyboard's focus, under `root` when one is given. */
export const focusedCompactCard = (root?: Node | null): HTMLElement | undefined => {
  if (typeof document === 'undefined' || root === null) return undefined;
  const focused = document.activeElement;
  const card = focused instanceof HTMLElement && focused.matches(COMPACT_ROOM_CARD_SELECTOR);
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
  const at = navigation?.ids.indexOf(cardKey(target as HTMLElement, navigation.idOf)) ?? -1;
  if (!navigation || at < 0 || !compactCardsIn(event.currentTarget).includes(target as HTMLElement))
    return;
  event.preventDefault();
  const next = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: navigation.ids.length - 1 }[key];
  navigation.focus(navigation.ids[next]);
};
