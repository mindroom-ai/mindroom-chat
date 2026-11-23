import { globalStyle, style } from '@vanilla-extract/css';
import { color, toRem } from 'folds';

/**
 * Concrete flex host around a covering side panel on phones so even `passthrough` panels
 * (`display: contents`) have a single box to translate during an interactive swipe.
 */
export const PhoneSidePanelHost = style({
  position: 'relative',
  flex: '1 1 auto',
  minInlineSize: 0,
  minBlockSize: 0,
  display: 'flex',
  selectors: {
    // Only form a stacking context while actively swiping above the revealed conversation & dim veil.
    '&[data-swiping]': { zIndex: 2 },
  },
});

/**
 * Keeps the wrapper element in place without drawing a box when a phone side panel is not
 * covering the conversation (for example, a plugin's own frame folded to its edge tab).
 */
export const PhoneSidePanelPassthrough = style({
  display: 'contents',
});

/**
 * Transparent start-edge touch catcher over iframe-bearing covering panels (`canvas`, `computer`)
 * so start-edge swipes reach the window touch handler instead of being swallowed by the iframe.
 * Starts below the 56 px side-panel header and stops above the footer action bar so normal DOM
 * controls stay unobstructed while their touches already bubble to `window` naturally.
 */
export const EdgeCatcher = style({
  position: 'absolute',
  insetBlockStart: toRem(56),
  insetBlockEnd: toRem(56),
  insetInlineStart: 0,
  inlineSize: '28px',
  zIndex: 10,
  pointerEvents: 'auto',
  touchAction: 'pan-y',
});

/**
 * Neutral themed surface backdrop shown behind a sliding live transcript when closing it restores
 * a docked call panel rather than the room conversation.
 */
export const PanelSwipeBackdrop = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  backgroundColor: color.Surface.Container,
  pointerEvents: 'none',
});

/** Subtle dim veil over the revealed under-layer while a covering side panel is dragged away. */
export const PanelSwipeDim = style({
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  backgroundColor: 'rgb(0 0 0)',
  pointerEvents: 'none',
});

// Establishes the containing block and clipping boundary on the room's layout stage during a swipe.
globalStyle('[data-swipe-panel-stage]', {
  position: 'relative',
  overflow: 'hidden',
  isolation: 'isolate',
});

// Temporarily reveals the mounted (still inert) conversation underneath a sliding covering panel.
globalStyle('[data-swipe-under-panel]', {
  position: 'absolute !important' as 'absolute',
  inset: '0 !important',
  flex: 'none !important',
  inlineSize: '100% !important',
  blockSize: '100% !important',
  contentVisibility: 'visible !important' as 'visible',
  overflow: 'hidden !important',
  pointerEvents: 'none !important' as 'none',
  zIndex: '0 !important',
});
