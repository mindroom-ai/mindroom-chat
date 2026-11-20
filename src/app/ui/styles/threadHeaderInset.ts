/** Marks the scroller a thread's sticky header (ThreadTimelineHeader) sits in, while it is mounted. */
export const THREAD_HEADER_SCROLLER_ATTRIBUTE = 'data-thread-header-scroller';
/** Marks that sticky header. */
export const THREAD_HEADER_ATTRIBUTE = 'data-thread-header';

/**
 * The scroller while a text field of its thread header has the focus. Its scroll padding then
 * leaves the header out (`ThreadTimelineHeader.css.ts`), so the caret a key reveals is in view
 * and the thread does not scroll; the header still covers the rows beneath it.
 */
export const typingInThreadHeader = `[${THREAD_HEADER_SCROLLER_ATTRIBUTE}]:has([${THREAD_HEADER_ATTRIBUTE}] :is(input, textarea, [contenteditable]):focus)`;

/**
 * How far down from a scroller's top the bars over its rows reach (the room header and a thread's
 * banner): its `scroll-padding-top` in px, plus the banner's height (which ThreadTimelineHeader
 * writes in px as `--room-thread-header-height` on the scroller's parent) while typing in the
 * banner takes it out of the padding.
 */
export const readTopInset = (scroller: Element): number => {
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  const top = Number.isFinite(padding) ? padding : 0;
  // Some tests hand in a stand-in for the scroller, without `matches`.
  if (typeof scroller.matches !== 'function' || !scroller.matches(typingInThreadHeader)) return top;
  const banner = Number.parseFloat(
    scroller.parentElement?.style.getPropertyValue('--room-thread-header-height') ?? ''
  );
  return top + (Number.isFinite(banner) ? banner : 0);
};
