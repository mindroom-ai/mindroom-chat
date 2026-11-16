// @vitest-environment jsdom
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardBeside,
  compactCardsIn,
  focusCompactCard,
  focusedCompactCard,
  handleCardArrowKey,
  noteCompactCardOrder,
  stepCompactThread,
} from './compactCardKeys';

const mountCards = (ids: string[]): HTMLElement => {
  const view = document.createElement('div');
  view.setAttribute('data-compact-room-view', 'true');
  view.innerHTML = ids
    .map((id) => `<div><button data-thread-root-id="${id}"></button><button>Resolve</button></div>`)
    .join('');
  document.body.append(view);
  return view;
};

const card = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;

const press = (view: HTMLElement, target: HTMLElement, key: string, modifiers = {}) => {
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
    expect(focusedCompactCard(view)).toBeUndefined();
    card('$b').focus();
    expect(focusedCompactCard(view)).toBe(card('$b'));
    card('$x').focus();
    expect(focusedCompactCard(view)).toBeUndefined();
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
});

describe('cardBeside', () => {
  it('is the card above or below the thread just left', () => {
    const view = mountCards(['$a', '$b', '$c']);
    const cards = compactCardsIn(view);
    expect(cardBeside(cards, '$b', 1)).toBe(card('$c'));
    expect(cardBeside(cards, '$b', -1)).toBe(card('$a'));
    // At either end, that thread's own card.
    expect(cardBeside(cards, '$c', 1)).toBe(card('$c'));
  });

  it('is the first card in view without one', () => {
    const view = mountCards(['$a', '$b']);
    const cards = compactCardsIn(view);
    expect(cardBeside(cards, undefined, 1)).toBe(card('$a'));
    expect(cardBeside(cards, '$gone', -1)).toBe(card('$a'));
    expect(cardBeside([], '$a', 1)).toBeUndefined();
  });
});

describe('stepCompactThread', () => {
  it("steps through the order the room's cards last showed", () => {
    noteCompactCardOrder('!room', ['$a', '$b', '$c']);
    expect(stepCompactThread('!room', '$b', 1)).toBe('$c');
    expect(stepCompactThread('!room', '$b', -1)).toBe('$a');
    expect(stepCompactThread('!room', '$c', 1)).toBeUndefined();
    // A thread without a card, and a room whose cards never showed.
    expect(stepCompactThread('!room', '$x', 1)).toBeUndefined();
    expect(stepCompactThread('!other', '$b', 1)).toBeUndefined();
  });
});
