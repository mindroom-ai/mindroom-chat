import { hasBlockingPortalOverlay } from './portalOverlay';

const OVERLAY_SELECTOR =
  '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/**
 * Whether a menu, listbox or dialog is open over `layer`, the one asking, or over the page without
 * one: for Escape in a phone's drawer and members sheet, which close on it before the page sees it,
 * and for the edge swipes, which a layer over theirs takes. Broader than
 * `hasBlockingPortalOverlay`, which sees only the portal container: folds portals its overlays and
 * menus into `body`. One left open in an inert page (a popover a drawer came out over) does not
 * count, nor anything inside `layer` or opened before it, under it (a dialog the image viewer
 * opened over). Hover tooltips have none of these roles.
 */
export const hasOpenOverlay = (layer?: Element | null): boolean =>
  hasBlockingPortalOverlay() ||
  Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(
    (overlay) =>
      !overlay.closest('[inert]') &&
      !layer?.contains(overlay) &&
      !(layer && layer.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_PRECEDING)
  );
