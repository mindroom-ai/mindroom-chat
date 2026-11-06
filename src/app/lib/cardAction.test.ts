// @vitest-environment jsdom
import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_ACTION_ATTRIBUTE, pressCardAction } from './cardAction';

/** A card with a topic, a menu button and its action button, in the document. */
const buildCard = () => {
  const card = document.createElement('div');
  card.innerHTML = `
    <span class="name">Harbor Plans</span>
    <span class="topic">Weekly notes and decisions</span>
    <button type="button" class="menu">More Options</button>
    <button type="button" class="action" ${CARD_ACTION_ATTRIBUTE}><span class="label">Join</span></button>
  `;
  document.body.append(card);
  const action = card.querySelector<HTMLButtonElement>('.action')!;
  const pressed = vi.fn();
  action.addEventListener('click', pressed);
  const click = (target: Element) =>
    pressCardAction({ currentTarget: card, target } as unknown as MouseEvent<HTMLElement>);
  return { card, action, pressed, click };
};

afterEach(() => {
  document.body.innerHTML = '';
  document.getSelection()?.removeAllRanges();
});

describe('pressCardAction', () => {
  it('presses the action button for a click on the card, its text or its padding', () => {
    const { card, pressed, click } = buildCard();
    click(card.querySelector('.topic')!);
    click(card.querySelector('.name')!);
    click(card);
    expect(pressed).toHaveBeenCalledTimes(3);
  });

  it('leaves clicks on the card’s own controls, the action included, to them', () => {
    const { card, pressed, click } = buildCard();
    click(card.querySelector('.menu')!);
    // The action's own click reaches the card too; it must not press the action a second time.
    click(card.querySelector('.label')!);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('does nothing while the action is disabled or busy, or when the card has none', () => {
    const { card, action, pressed, click } = buildCard();
    action.setAttribute('aria-disabled', 'true');
    click(card.querySelector('.topic')!);
    action.removeAttribute('aria-disabled');
    action.disabled = true;
    click(card.querySelector('.topic')!);
    action.remove();
    click(card.querySelector('.topic')!);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('ignores clicks from pop-outs outside the card that reach it through a portal', () => {
    const { pressed, click } = buildCard();
    const dialog = document.createElement('div');
    document.body.append(dialog);
    click(dialog);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('ignores the click that ends a text selection in the card', () => {
    const { card, pressed, click } = buildCard();
    const topic = card.querySelector('.topic')!;
    const range = document.createRange();
    range.selectNodeContents(topic);
    document.getSelection()?.addRange(range);
    click(topic);
    expect(pressed).not.toHaveBeenCalled();
  });
});
