import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keeps a panel that opens under a control of the thread filter bar inside the bar: a panel that
 * would overhang its end (on a phone, or under a control near the end) moves back, as far as the
 * bar's start allows, and one that would overhang its start moves forward. Runs after every
 * render, so the panel follows the bar as it wraps.
 */
export const useKeepInsideToolbar = (panelRef: RefObject<HTMLElement>) => {
  const shiftRef = useRef(0);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const bar = panel?.parentElement?.closest('[role="toolbar"]')?.getBoundingClientRect();
    if (!panel || !bar) return;
    const box = panel.getBoundingClientRect();
    const start = box.left - shiftRef.current;
    const end = box.right - shiftRef.current;
    let shift = end > bar.right ? bar.right - end : 0;
    if (start + shift < bar.left) shift = bar.left - start;
    if (shift === shiftRef.current) return;
    shiftRef.current = shift;
    panel.style.translate = shift ? `${shift}px` : '';
  });
};
