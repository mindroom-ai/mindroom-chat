const PORTAL_CONTAINER_ID = 'portalContainer';

/**
 * True when the app's portal container hosts a modal, popover, or other
 * overlay. Callers use this to defer keyboard shortcuts and edge-swipes so they
 * don't fight the active overlay. Hover tooltips mount there too but never take
 * input, so they don't count; otherwise resting the pointer on a tooltip that
 * names a shortcut would make that shortcut do nothing.
 */
export const hasBlockingPortalOverlay = (): boolean => {
  if (typeof document === 'undefined') return false;
  const container = document.getElementById(PORTAL_CONTAINER_ID);
  if (!container) return false;
  return Array.from(container.children).some((child) => child.getAttribute('role') !== 'tooltip');
};
