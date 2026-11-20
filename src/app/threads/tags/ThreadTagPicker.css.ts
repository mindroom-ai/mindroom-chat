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
// on a row (ThreadActionsMenu). A ✕ sits 0.25rem inside its pill's top and bottom, so it reaches
// 0.6rem up and down, short of the middle between two rows of ✕es (0.63rem). The "+ tag" button
// fills its row, so it reaches 0.4rem, short of the ✕ reaching down from the row above. The
// last tag's ✕ and "+ tag" share the 0.9rem between them (the pill's end padding and the gap).
const MENU_TAGS = '[data-thread-menu-tags]';
globalTouchTarget(`${MENU_TAGS} .thread-tag-pill-remove`, '22px', { blockReach: '0.6rem' });
globalTouchTarget(
  `${MENU_TAGS} .thread-tag-pill:has(+ button) .thread-tag-pill-remove`,
  '0.45rem',
  {
    blockReach: '0.6rem',
  }
);
globalTouchTarget(`${MENU_TAGS} button[aria-haspopup="menu"]`, '0.45rem', {
  blockReach: '0.4rem',
});
