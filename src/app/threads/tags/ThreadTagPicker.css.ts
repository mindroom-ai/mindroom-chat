import { style } from '@vanilla-extract/css';
import { globalTouchTarget, touchTarget } from '../../ui/styles/touchTarget';

// The thread banner's tag controls are small: to a finger each is 44 px tall and reaches halfway
// into the 12 px between a tag's ✕ and the next control.
export const AddTag = style(touchTarget('6px'));
globalTouchTarget('[data-thread-context-banner] .thread-tag-pill-remove', '6px');
