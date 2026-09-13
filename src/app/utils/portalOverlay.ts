const PORTAL_CONTAINER_ID = 'portalContainer';

/**
 * True when the app's portal container hosts any children — i.e. some modal,
 * popover, or overlay is currently mounted. Callers use this to defer keyboard
 * shortcuts and edge-swipes so they don't fight the active overlay.
 */
export const hasBlockingPortalOverlay = (): boolean => {
  if (typeof document === 'undefined') return false;
  return (document.getElementById(PORTAL_CONTAINER_ID)?.childElementCount ?? 0) > 0;
};
