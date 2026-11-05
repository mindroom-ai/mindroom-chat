import { portalContainer } from '../../utils/portalOverlay';
import type { ShortcutContext } from './shortcuts';

/** Marks the help dialog, the one overlay that leaves its own toggle working. */
export const HELP_DIALOG_ATTRIBUTE = 'data-shortcut-help';

/** The open overlays in the app's portal container; hover tooltips take no input and don't count. */
export const openOverlay = (): ShortcutContext['overlay'] => {
  const layers = Array.from(portalContainer?.children ?? []).filter(
    (child) => child.getAttribute('role') !== 'tooltip'
  );
  if (layers.length === 0) return 'none';
  return layers.every((layer) => layer.querySelector(`[${HELP_DIALOG_ATTRIBUTE}]`))
    ? 'help'
    : 'other';
};

/** Selected text in a field or on the page, which ⌘C or Ctrl+C is likely about to copy. */
export const hasTextSelection = (): boolean => {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
    try {
      if (focused.selectionStart !== focused.selectionEnd) return true;
    } catch {
      // Inputs without a text selection (number, email) throw on reading it.
    }
  }
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString() !== '';
};
