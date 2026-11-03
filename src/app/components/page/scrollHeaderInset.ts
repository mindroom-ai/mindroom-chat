/** Set on a scroll frame by `useStickyHeaderInset`: the height of its sticky title, if any. */
export const SCROLL_HEADER_HEIGHT_PROPERTY = '--page-scroll-header-height';

/** The sticky title's height where the frame's scrollbar and viewport read it. */
export const scrollHeaderHeight = `var(${SCROLL_HEADER_HEIGHT_PROPERTY}, 0px)`;
