import { DRAG_NO_SELECT } from './dragSelection.css';

/** The releases of the drags (a splitter, a scrollbar) that hold the block below. */
const holds = new Set<(left?: boolean) => void>();
const prevent = (event: Event) => event.preventDefault();
const leave = () => holds.forEach((release) => release(true));
const setBlocked = (blocked: boolean) => {
  if (blocked) document.addEventListener('selectstart', prevent, true);
  else document.removeEventListener('selectstart', prevent, true);
  if (blocked) window.addEventListener('pagehide', leave);
  else window.removeEventListener('pagehide', leave);
  // Text already selected keeps its highlight: Chromium on macOS paints it no more once unblocked.
  const kept = blocked && window.getSelection()?.isCollapsed === false;
  document.documentElement.toggleAttribute(DRAG_NO_SELECT, blocked && !kept);
};

/**
 * Keeps the page from selecting text, leaving what was selected, until every drag holding it lets
 * go, once each: the Mac app's web view selected the page under a drag that cancelled its press.
 * A page left mid-drag (Back) may lack the drags' ends: each hold goes and its `onLeave` runs.
 */
export const blockSelection = (onLeave?: () => void): (() => void) => {
  const release = (left?: boolean) => {
    if (!holds.delete(release)) return;
    if (holds.size === 0) setBlocked(false);
    if (left) onLeave?.();
  };
  if (holds.add(release).size === 1) setBlocked(true);
  return () => release();
};
