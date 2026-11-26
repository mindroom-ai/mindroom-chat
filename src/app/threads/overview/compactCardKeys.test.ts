// @vitest-environment jsdom
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compactCardNavigation,
  compactCardsIn,
  focusCardBeside,
  focusCompactCard,
  focusedCompactCard,
  handleCardArrowKey,
} from './compactCardKeys';

const mountCards = (ids: string[]) => {
  const view = document.createElement('div');
  view.setAttribute('data-compact-room-view', 'true');
  for (const id of ids) {
    const shell = document.createElement('div');
    shell.dataset.scrollAnchor = id;
    const button = document.createElement('button');
    button.dataset.threadRootId = id;
    const resolve = document.createElement('button');
    shell.append(button, resolve);
    view.append(shell);
  }
  document.body.append(view);
  compactCardNavigation.set(view, {
    ids,
    focus: (id) =>
      focusCompactCard(compactCardsIn(view).find((el) => el.dataset.threadRootId === id)),
  });
  return view;
};

const card = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;

const press = (
  view: HTMLElement,
  target: HTMLElement,
  key: string,
  modifiers: Partial<KeyboardEvent> = {}
): boolean => {
  let prevented = false;
  handleCardArrowKey({
    key,
    target,
    currentTarget: view,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
    ...modifiers,
  } as unknown as ReactKeyboardEvent<HTMLElement>);
  return prevented;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('compactCardsIn and focusedCompactCard', () => {
  it('finds the cards of a Compact room in the order they show, and the focused one', () => {
    const view = mountCards(['$a', '$b']);
    // A reply's link to its thread elsewhere on the page is no card.
    document.body.insertAdjacentHTML('beforeend', '<button data-thread-root-id="$x"></button>');
    expect(compactCardsIn(document.body).map((element) => element.dataset.threadRootId)).toEqual([
      '$a',
      '$b',
    ]);
    expect(compactCardsIn(null)).toEqual([]);
    // A card that is fading out of the list is inert, and no card to go to.
    card('$a').parentElement!.setAttribute('inert', '');
    expect(compactCardsIn(view).map((element) => element.dataset.threadRootId)).toEqual(['$b']);
    card('$a').parentElement!.removeAttribute('inert');
    expect(focusedCompactCard()).toBeUndefined();
    card('$b').focus();
    expect(focusedCompactCard()).toBe(card('$b'));
    expect(focusedCompactCard(view)).toBe(card('$b'));
    card('$x').focus();
    expect(focusedCompactCard()).toBeUndefined();
    // A board column's compact view outside `view` matches unscoped `focusedCompactCard()`.
    const boardView = mountCards(['$board']);
    card('$board').focus();
    expect(focusedCompactCard()).toBe(card('$board'));
    expect(focusedCompactCard(view)).toBeUndefined();
    expect(focusedCompactCard(boardView)).toBe(card('$board'));
    // Space All-threads cards are navigable in their own list, but excluded from `focusedCompactCard()`.
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-space-threads-list="true"><button data-thread-root-id="$s"></button></div>'
    );
    const spaceList = document.querySelector<HTMLElement>('[data-space-threads-list]')!;
    const spaceCard = spaceList.querySelector<HTMLElement>('[data-thread-root-id="$s"]')!;
    expect(compactCardsIn(spaceList)).toEqual([spaceCard]);
    spaceCard.focus();
    expect(focusedCompactCard()).toBeUndefined();
    expect(focusedCompactCard(spaceList)).toBeUndefined();
    expect(focusedCompactCard(null)).toBeUndefined();
  });
});

describe('focusCompactCard', () => {
  it('focuses the card and marks it key-focused until the focus leaves', () => {
    mountCards(['$a', '$b']);
    expect(focusCompactCard(card('$a'))).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    expect(card('$a').hasAttribute('data-key-focus')).toBe(true);
    focusCompactCard(card('$b'));
    expect(card('$a').hasAttribute('data-key-focus')).toBe(false);
    expect(card('$b').hasAttribute('data-key-focus')).toBe(true);
    expect(focusCompactCard(undefined)).toBe(false);
    // A window that loses the focus blurs the card, which keeps both the focus and the mark.
    card('$b').dispatchEvent(new FocusEvent('blur'));
    expect(card('$b').hasAttribute('data-key-focus')).toBe(true);
    card('$b').blur();
    expect(card('$b').hasAttribute('data-key-focus')).toBe(false);
  });
});

describe('handleCardArrowKey', () => {
  it('moves the focus between cards with the arrows, Home and End', () => {
    const view = mountCards(['$a', '$b', '$c']);
    card('$a').focus();
    expect(press(view, card('$a'), 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(card('$b'));
    press(view, card('$b'), 'End');
    expect(document.activeElement).toBe(card('$c'));
    // Past the last card the focus stays, and the page does not scroll.
    expect(press(view, card('$c'), 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(card('$c'));
    press(view, card('$c'), 'ArrowUp');
    expect(document.activeElement).toBe(card('$b'));
    press(view, card('$b'), 'Home');
    expect(document.activeElement).toBe(card('$a'));
  });

  it("leaves other keys, chords and a card's own buttons alone", () => {
    const view = mountCards(['$a', '$b']);
    card('$a').focus();
    expect(press(view, card('$a'), 'j')).toBe(false);
    expect(press(view, card('$a'), 'ArrowDown', { altKey: true })).toBe(false);
    const resolve = view.querySelector<HTMLElement>('button:not([data-thread-root-id])')!;
    expect(press(view, resolve, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(card('$a'));
  });

  it('leaves Tab and Shift+Tab to the browser, which follows the order of the page', () => {
    const view = mountCards(['$a', '$d']);
    const focus = vi.fn(() => true);
    compactCardNavigation.set(view, { ids: ['$a', '$b', '$c', '$d'], focus });
    const actions = card('$a').parentElement!.querySelectorAll<HTMLElement>('button');
    expect(press(view, actions[1]!, 'Tab')).toBe(false);
    expect(press(view, card('$d'), 'Tab', { shiftKey: true })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('focusCardBeside', () => {
  it('focuses the card above or below the thread just left, or exactly its own', () => {
    const view = mountCards(['$a', '$b', '$c']);
    expect(focusCardBeside(view, '$b', 1)).toBe(true);
    expect(document.activeElement).toBe(card('$c'));
    expect(focusCardBeside(view, '$b', -1)).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    // At either end, that thread's own card.
    expect(focusCardBeside(view, '$c', 1)).toBe(true);
    expect(document.activeElement).toBe(card('$c'));
    const focus = vi.fn(() => true);
    compactCardNavigation.set(view, { ids: ['$a', '$b', '$c'], focus });
    expect(focusCardBeside(view, '$b', 0, true)).toBe(true);
    expect(focus).toHaveBeenLastCalledWith('$b');
    expect(focusCardBeside(view, '$gone', 0, true)).toBe(false);
  });

  it('falls back to the first card in view when not exact', () => {
    const view = mountCards(['$a', '$b']);
    expect(focusCardBeside(view, undefined, 1)).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    expect(focusCardBeside(view, '$gone', -1)).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    expect(focusCardBeside(null, '$a', 1)).toBe(false);
  });
});
