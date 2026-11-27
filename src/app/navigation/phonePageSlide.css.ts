import { globalStyle } from '@vanilla-extract/css';
import { color } from 'folds';

// Live 2-layer phone navigation stack (phonePageSlide.ts): two live DOM layers slide past each
// other with GPU `translate` inside a rectangular `overflow: clip` stage (zero DOM cloning, zero
// `<canvas>` bitmaps, zero `clip-path` masks).

// Cold-reload fallback stage clipping when no live under-layer was mounted yet.
globalStyle('[data-phone-stage][data-swipe-stage]', {
  overflow: 'clip',
  isolation: 'isolate',
});

// Neutral themed surface backdrop for cold-reload swipe-back fallback (kept below the top bar).
globalStyle('[data-swipe-backdrop]', {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  pointerEvents: 'none',
  backgroundColor: 'var(--app-bg-color)',
});

// Subtle dim veil between the live upper and lower layers during a slide or swipe.
globalStyle('[data-swipe-dim]', {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  backgroundColor: 'rgb(0 0 0)',
  pointerEvents: 'none',
});

// Blocks double-taps while a live slide plays or an interactive swipe settles and awaits commit.
globalStyle('[data-swipe-hold-shield]', {
  position: 'absolute',
  inset: 0,
  zIndex: 3,
  pointerEvents: 'auto',
});

// Live 2-layer navigation stage (RoomView and SpaceSectionPage).
globalStyle('[data-swipe-thread-stage]', {
  position: 'relative',
  overflow: 'clip',
  isolation: 'isolate',
});

// Live inert under-layer revealed behind a sliding upper surface.
globalStyle('[data-swipe-under-thread]', {
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

// Live upper layer sliding over the revealed under-layer and dim veil.
globalStyle('[data-swipe-over-thread]', {
  position: 'relative',
  zIndex: 2,
  backgroundColor: color.Surface.Container,
});

// Cold-reload fallback lifts inline clipping on [data-phone-page] while sliding so its 16 px
// leading-edge ::before shadow renders cleanly inside the clipped [data-phone-stage].
globalStyle('[data-phone-stage][data-swipe-stage] > [data-phone-page][data-swipe-over-thread]', {
  overflowInline: 'visible',
  overflowBlock: 'clip',
});
