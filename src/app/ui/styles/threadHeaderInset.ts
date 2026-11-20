/** Marks the scroller a thread's sticky header (ThreadTimelineHeader) sits in, while it is mounted. */
export const THREAD_HEADER_SCROLLER_ATTRIBUTE = 'data-thread-header-scroller';
/** Marks that sticky header. */
export const THREAD_HEADER_ATTRIBUTE = 'data-thread-header';
/** The fields a key types into, whose caret the browser reveals. */
export const TEXT_FIELD = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * The scroller while a text field of its thread header has the focus. Its scroll padding then
 * leaves the header out (`ThreadTimelineHeader.css.ts`), so the caret a key reveals is in view
 * and the thread does not scroll; the header still covers the rows beneath it. A browser without
 * `:has()` ignores the rule.
 */
export const typingInThreadHeader = `[${THREAD_HEADER_SCROLLER_ATTRIBUTE}]:has([${THREAD_HEADER_ATTRIBUTE}] :is(${TEXT_FIELD}):focus)`;

/**
 * Whether `typingInThreadHeader` holds for the scroller, read from the focused element: matching
 * `:has()` in script throws where the browser cannot parse it.
 */
const typingInHeaderOf = (scroller: Element): boolean => {
  // Some tests hand in a stand-in for the scroller, without a document.
  const active = (scroller.ownerDocument as Document | undefined)?.activeElement;
  if (!active?.matches(TEXT_FIELD) || !scroller.hasAttribute(THREAD_HEADER_SCROLLER_ATTRIBUTE)) {
    return false;
  }
  const header = active.closest(`[${THREAD_HEADER_ATTRIBUTE}]`);
  return !!header && scroller.contains(header);
};

/**
 * How far down from a scroller's top the bars over its rows reach (the room header and a thread's
 * banner): its `scroll-padding-top` in px, plus the banner's height (which ThreadTimelineHeader
 * writes in px as `--room-thread-header-height` on the scroller's parent) while typing in the
 * banner takes it out of the padding.
 */
export const readTopInset = (scroller: Element): number => {
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  const top = Number.isFinite(padding) ? padding : 0;
  if (!typingInHeaderOf(scroller)) return top;
  const banner = Number.parseFloat(
    scroller.parentElement?.style.getPropertyValue('--room-thread-header-height') ?? ''
  );
  return top + (Number.isFinite(banner) ? banner : 0);
};
