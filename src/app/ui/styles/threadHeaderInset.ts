/** Marks the scroller a thread's sticky header (ThreadTimelineHeader) sits in, while it is mounted. */
export const THREAD_HEADER_SCROLLER_ATTRIBUTE = 'data-thread-header-scroller';
/** Marks that sticky header. */
export const THREAD_HEADER_ATTRIBUTE = 'data-thread-header';
/**
 * Set on the scroller by the rule that takes the thread header out of its scroll padding while a
 * text field of the header has the focus (ThreadTimelineHeader.css.ts). The rule sets both, so a
 * browser that does not apply it (one without `:has()`) leaves the padding whole and the flag
 * unset alike.
 */
export const HEADER_OUT_OF_PADDING = '--thread-header-out-of-padding';

/**
 * How far down from a scroller's top the bars over its rows reach (the room header and a thread's
 * banner): its `scroll-padding-top` in px, plus the banner's height (which ThreadTimelineHeader
 * writes in px as `--room-thread-header-height` on the scroller's parent) while the rule above
 * leaves the banner out of the padding.
 */
export const readTopInset = (scroller: Element): number => {
  const style = getComputedStyle(scroller);
  const padding = Number.parseFloat(style.scrollPaddingTop);
  const top = Number.isFinite(padding) ? padding : 0;
  // Some tests stand in a computed style with the padding alone.
  const flag =
    typeof style.getPropertyValue === 'function'
      ? style.getPropertyValue(HEADER_OUT_OF_PADDING)
      : '';
  if (!flag.trim()) return top;
  const banner = Number.parseFloat(
    scroller.parentElement?.style.getPropertyValue('--room-thread-header-height') ?? ''
  );
  return top + (Number.isFinite(banner) ? banner : 0);
};
