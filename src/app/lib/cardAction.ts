import type { MouseEvent } from 'react';

/** Marks the button that a click elsewhere on its card presses. */
export const CARD_ACTION_ATTRIBUTE = 'data-card-action';

/** Props that make a button its card's action. */
export const cardActionProps = { [CARD_ACTION_ATTRIBUTE]: '' } as const;

/** A card's action, while it can be pressed. */
export const ENABLED_CARD_ACTION = `[${CARD_ACTION_ATTRIBUTE}]:not(:disabled):not([aria-disabled="true"])`;

// The card's own controls keep their clicks.
const CONTROLS = 'button, a[href], input, select, textarea, [role="button"]';

/**
 * A card's click handler: a click on the card, away from its controls, presses the card's action
 * button, so the card always does what that button does, and nothing while the button is disabled
 * or busy or the card has none. Clicks on the card's own controls, clicks in pop-outs that reach
 * the card through React portals, and the click that ends a text selection in the card are left
 * alone.
 */
export const pressCardAction = (event: MouseEvent<HTMLElement>): void => {
  const card = event.currentTarget;
  const { target } = event;
  if (!(target instanceof Element) || !card.contains(target)) return;
  const control = target.closest(CONTROLS);
  if (control && card.contains(control)) return;
  const selection = card.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed && card.contains(selection.anchorNode)) return;
  card.querySelector<HTMLElement>(ENABLED_CARD_ACTION)?.click();
};
