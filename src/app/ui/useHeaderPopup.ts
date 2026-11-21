import { createContext, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { stopPropagation } from '../lib/keyboard';
import { useLiveAnchor } from './useAnchoredCard';

type RestoreFocus = (opener?: HTMLElement) => void;

/** Lets controls drawn by the calls domain return focus to the header that owns them. */
export const RestoreHeaderFocus = createContext<RestoreFocus>(() => undefined);

/** Escape dismisses the overlay; a click outside closes it without restoring focus. */
export const headerDismissTrap = (onClose: (dismissed?: boolean) => void) => ({
  initialFocus: false as const,
  returnFocusOnDeactivate: false,
  clickOutsideDeactivates: () => {
    onClose();
    return true;
  },
  escapeDeactivates: (event: KeyboardEvent) => {
    if (!stopPropagation(event)) return false;
    onClose(true);
    return true;
  },
});

export function useHeaderPopup(restoreFocus: RestoreFocus, available = true) {
  const [opener, open] = useState<HTMLButtonElement>();
  const close = useCallback(() => open(undefined), []);
  const anchor = useLiveAnchor(available ? opener : undefined, close);

  useLayoutEffect(() => {
    if (available || !opener) return;
    close();
    if (opener.isConnected) restoreFocus(opener);
  }, [available, opener, close, restoreFocus]);
  // The entire control can unmount (e.g. the call offer goes away), stopping its tracker.
  useEffect(() => {
    if (!opener) return undefined;
    return () => {
      if (!opener.isConnected) restoreFocus(opener);
    };
  }, [opener, restoreFocus]);

  const dismiss = () => {
    close();
    restoreFocus(opener);
  };
  const trap = headerDismissTrap((dismissed) => (dismissed ? dismiss() : close()));
  return { opener, anchor, open, close, dismiss, trap };
}
