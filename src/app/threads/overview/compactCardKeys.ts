import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** The button of a Compact room's card that opens its thread. */
const VIEW_SELECTOR = '[data-compact-room-view]';
const CARD_SELECTOR = `${VIEW_SELECTOR} [data-thread-root-id]`;
const TABBABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The full keyboard order and focus command for each mounted Compact scroller. */
export const compactCardNavigation = new WeakMap<
  Element,
  { ids: readonly string[]; focus: (id: string | undefined, preventScroll?: boolean) => boolean }
>();

const navigationIn = (root: HTMLElement | null) => {
  const view = root?.closest(VIEW_SELECTOR) ?? root?.querySelector(VIEW_SELECTOR);
  return view ? compactCardNavigation.get(view) : undefined;
};

/**
 * Marks a card the keys focused. A browser shows `:focus-visible` on a script's focus only after
 * a plain key: after a chord (⌘ or Ctrl, Alt and an arrow) that follows a click it shows none, so
 * the card's styles draw the ring for this mark as well.
 */
export const KEY_FOCUS_ATTRIBUTE = 'data-key-focus';

/** Moves the keyboard's focus to `card`, and shows it there. False without a card. */
export const focusCompactCard = (card: HTMLElement | undefined, preventScroll = false): boolean => {
  if (!card) return false;
  card.setAttribute(KEY_FOCUS_ATTRIBUTE, '');
  // Until the focus moves on: a window that loses the focus blurs the card too, which keeps it.
  const onBlur = () => {
    if (card.ownerDocument.activeElement === card) return;
    card.removeAttribute(KEY_FOCUS_ATTRIBUTE);
    card.removeEventListener('blur', onBlur);
  };
  card.addEventListener('blur', onBlur);
  card.focus({ preventScroll });
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
  exact = false,
  preventScroll = false
): boolean => {
  const navigation = navigationIn(root);
  const index = id === undefined ? -1 : navigation?.ids.indexOf(id) ?? -1;
  if (navigation && index >= 0) {
    return navigation.focus(navigation.ids[index + step] ?? navigation.ids[index], preventScroll);
  }
  return exact ? false : focusCompactCard(firstCardInView(compactCardsIn(root)), preventScroll);
};

/**
 * On a focused card, the up and down arrows, Home and End move the focus between the cards, and
 * Tab/Shift+Tab materialize a logical neighbour when leaving a card across a spacer. A card's own
 * buttons and every chord keep their keys.
 */
export const handleCardArrowKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const navigation = navigationIn(event.currentTarget);
  if (!navigation) return;
  const { key, target, shiftKey } = event;
  if (key === 'Tab' && target instanceof HTMLElement) {
    const shell = target.closest<HTMLElement>('[data-scroll-anchor]');
    if (!shell) return;
    const tabbable = [...shell.querySelectorAll<HTMLElement>(TABBABLE)].filter(
      (node) => !node.closest('[inert], [hidden]')
    );
    const edge = shiftKey ? tabbable[0] : tabbable.at(-1);
    const gap = shiftKey ? shell.previousElementSibling : shell.nextElementSibling;
    if (target !== edge || !gap?.hasAttribute('data-compact-spacer')) return;
    const at = navigation.ids.indexOf(shell.dataset.scrollAnchor ?? '');
    const next = at < 0 ? undefined : navigation.ids[at + (shiftKey ? -1 : 1)];
    if (!next) return;
    event.preventDefault();
    navigation.focus(next);
    return;
  }
  if (shiftKey || (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End'))
    return;
  const cards = compactCardsIn(event.currentTarget);
  const index = cards.indexOf(target as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const at = navigation.ids.indexOf(cards[index]?.dataset.threadRootId ?? '');
  const next =
    navigation.ids[
      { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: navigation.ids.length - 1 }[key]
    ];
  navigation.focus(next);
};
