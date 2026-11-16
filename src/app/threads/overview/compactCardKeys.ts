import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** The button of a Compact room's card that opens its thread. */
const CARD_SELECTOR = '[data-compact-room-view] [data-thread-root-id]';

/**
 * Marks a card the keys focused. A browser shows `:focus-visible` on a script's focus only after
 * a plain key: after a chord (⌘ or Ctrl, Alt and an arrow) that follows a click it shows none, so
 * the card's styles draw the ring for this mark as well.
 */
export const KEY_FOCUS_ATTRIBUTE = 'data-key-focus';

/** Moves the keyboard's focus to `card`, and shows it there. False without a card. */
export const focusCompactCard = (card: HTMLElement | undefined): boolean => {
  if (!card) return false;
  card.setAttribute(KEY_FOCUS_ATTRIBUTE, '');
  card.addEventListener('blur', () => card.removeAttribute(KEY_FOCUS_ATTRIBUTE), { once: true });
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
  const view = cards[0]?.closest('[data-compact-room-view]');
  if (!view) return cards[0];
  const top =
    view.getBoundingClientRect().top + (parseFloat(getComputedStyle(view).scrollPaddingTop) || 0);
  return cards.find((card) => card.getBoundingClientRect().top >= top - 1) ?? cards[0];
};

/**
 * Where the focus goes from outside the cards: the card `step` places from the thread just left
 * (that thread's own card at either end, and for no step), or the first card in view when its
 * card does not show.
 */
export const cardBeside = (
  cards: readonly HTMLElement[],
  leftThreadId: string | undefined,
  step: -1 | 0 | 1
): HTMLElement | undefined => {
  const index = cards.findIndex((card) => card.dataset.threadRootId === leftThreadId);
  if (leftThreadId === undefined || index < 0) return firstCardInView(cards);
  return cards[index + step] ?? cards[index];
};

/**
 * On a focused card, the up and down arrows, Home and End move the focus between the cards. A
 * card's own buttons and every chord keep their keys.
 */
export const handleCardArrowKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const { key, target } = event;
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return;
  const cards = compactCardsIn(event.currentTarget);
  const index = cards.indexOf(target as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const next = {
    ArrowUp: cards[index - 1],
    ArrowDown: cards[index + 1],
    Home: cards[0],
    End: cards[cards.length - 1],
  }[key];
  focusCompactCard(next);
};

// The room's cards unmount under a thread that fills the page, so the order they last showed
// stays here, per room, for stepping from that thread to the next.
const shownOrders = new Map<string, readonly string[]>();
let openThread: { roomId: string; threadId: string } | undefined;

/**
 * Names the room's open thread. It keeps its place in the order when its card leaves the list
 * beside it (resolved or snoozed under a filter that hides such threads), so the keys still step
 * on from it.
 */
export const holdCompactThreadPlace = (roomId: string, threadId: string | undefined): void => {
  openThread = threadId === undefined ? undefined : { roomId, threadId };
};

export const noteCompactCardOrder = (roomId: string, threadIds: readonly string[]): void => {
  const before = shownOrders.get(roomId);
  const held = openThread?.roomId === roomId ? openThread.threadId : undefined;
  const place = held === undefined || threadIds.includes(held) ? -1 : before?.indexOf(held) ?? -1;
  if (held === undefined || !before || place < 0) {
    shownOrders.set(roomId, threadIds);
    return;
  }
  // After the nearest card above it that still shows, or first.
  const above = before
    .slice(0, place)
    .reverse()
    .find((threadId) => threadIds.includes(threadId));
  const at = above === undefined ? 0 : threadIds.indexOf(above) + 1;
  shownOrders.set(roomId, [...threadIds.slice(0, at), held, ...threadIds.slice(at)]);
};

/** The thread `step` cards from `threadId` in the order the room's cards last showed. */
export const stepCompactThread = (
  roomId: string,
  threadId: string,
  step: -1 | 1
): string | undefined => {
  const order = shownOrders.get(roomId);
  const index = order?.indexOf(threadId) ?? -1;
  return index < 0 ? undefined : order?.[index + step];
};

// The card the keys want focused once the room shows it: that of the thread they left.
let wantedCard: { roomId: string; threadId: string } | undefined;

export const wantCompactCard = (roomId: string, threadId: string | undefined): void => {
  wantedCard = threadId === undefined ? undefined : { roomId, threadId };
};

/** The thread whose card the keys want focused in the room, if any. */
export const wantedCompactCard = (roomId: string): string | undefined =>
  wantedCard?.roomId === roomId ? wantedCard.threadId : undefined;
