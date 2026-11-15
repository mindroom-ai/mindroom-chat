/**
 * Whether the person asked their system for less motion. The tour then shows each scene's last
 * phase at once and moves nothing. False where the page cannot ask.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Whether the main pointer is a finger, which gets no focus it did not ask for. */
export const hasCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/**
 * The motion tokens `Slower` and `Standard` (ui/styles/Motion.css.ts) as numbers and text, for
 * the Web Animations the tour plays from script, which cannot read a custom property.
 */
export const GLIDE_MS = 280;
export const GLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/** How long one view of the stage takes to fade into the next: the token `Normal`. */
export const VIEW_FADE_MS = 160;
