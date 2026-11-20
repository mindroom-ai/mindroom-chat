const PORTAL_CONTAINER_ID = 'portalContainer';

// Modal sheets mount in `body`, outside the portal container, and hide everything else while open.
let openModalSheets = 0;
/** Counts an open modal sheet as a blocking overlay until the returned release runs. */
export const holdModalSheet = (): (() => void) => {
  openModalSheets += 1;
  return () => {
    openModalSheets -= 1;
  };
};
export const modalSheetOpen = (): boolean => openModalSheets > 0;

/**
 * The app's portal container from index.html, looked up once at startup.
 * Message HTML can carry its own element with this id, and a later lookup by
 * id would find that one first, because messages come earlier in the page.
 */
export const portalContainer =
  (typeof document === 'undefined' ? null : document.getElementById(PORTAL_CONTAINER_ID)) ??
  undefined;

/**
 * True when the app's portal container hosts a modal, popover, or other
 * overlay. Callers use this to defer keyboard shortcuts and edge-swipes so they
 * don't fight the active overlay. Hover tooltips mount there too but never take
 * input, so they don't count; otherwise resting the pointer on a tooltip that
 * names a shortcut would make that shortcut do nothing.
 */
export const hasBlockingPortalOverlay = (): boolean => {
  if (openModalSheets > 0) return true;
  if (!portalContainer) return false;
  return Array.from(portalContainer.children).some(
    (child) => child.getAttribute('role') !== 'tooltip'
  );
};
