import { hasBlockingPortalOverlay } from './portalOverlay';

/**
 * Whether a menu, listbox or dialog is open, so Escape is theirs: for a phone's drawer and members
 * sheet, which close on Escape before the page sees it. Broader than `hasBlockingPortalOverlay`,
 * which sees only the portal container: folds menus portal into `body`. One left open in an inert
 * page (a popover a drawer came out over) does not count, nor anything inside `layer`, the one
 * asking.
 */
export const hasOpenOverlay = (layer?: Element | null): boolean =>
  hasBlockingPortalOverlay() ||
  Array.from(
    document.querySelectorAll(
      '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]'
    )
  ).some((overlay) => !overlay.closest('[inert]') && !layer?.contains(overlay));
