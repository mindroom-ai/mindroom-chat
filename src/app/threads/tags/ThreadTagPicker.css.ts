import { style } from '@vanilla-extract/css';
import { globalTouchTarget, touchTarget } from '../../ui/styles/touchTarget';

// The thread banner's tag controls are small: to a finger each is 44 px tall and 44 px wide, but
// the last tag's ✕ and the "+ tag" button share the 12 px between them, halfway each.
export const AddTag = style(touchTarget('6px'));
globalTouchTarget('[data-thread-context-banner] .thread-tag-pill-remove', '22px');
globalTouchTarget(
  '[data-thread-context-banner] .thread-tag-pill:has(+ button) .thread-tag-pill-remove',
  '6px'
);

// At the top of a phone's thread menu the tags wrap onto rows 0.75rem apart, 0.5rem between two
// on a row (ThreadActionsMenu), and no two touch areas meet. Two rows of ✕es are 1rem apart, so
// each reaches 0.5rem up and down; a ✕ and the "+ tag" button, which fills its row, are 0.75rem
// apart, the ✕'s 0.5rem and the button's 0.25rem. Along a row two ✕es are at least 1.5rem apart
// (a one-letter tag between them), so each reaches 0.7rem; the last tag's ✕ and "+ tag" share
// the 0.9rem between them (the pill's end padding and the gap).
const MENU_TAGS = '[data-thread-menu-tags]';
globalTouchTarget(`${MENU_TAGS} .thread-tag-pill-remove`, '0.7rem', { blockReach: '0.5rem' });
globalTouchTarget(
  `${MENU_TAGS} .thread-tag-pill:has(+ button) .thread-tag-pill-remove`,
  '0.45rem',
  {
    blockReach: '0.5rem',
  }
);
globalTouchTarget(`${MENU_TAGS} button[aria-haspopup="menu"]`, '0.45rem', {
  blockReach: '0.25rem',
});
