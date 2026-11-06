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
