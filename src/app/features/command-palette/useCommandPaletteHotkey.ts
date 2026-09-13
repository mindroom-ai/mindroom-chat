import { useCallback } from 'react';
import { useKeyDown } from '../../hooks/useKeyDown';

const hasBlockingPortalOverlay = (): boolean => {
  const portalContainer = document.getElementById('portalContainer');
  return !!portalContainer && portalContainer.children.length > 0;
};

export const useCommandPaletteHotkey = (
  opened: boolean,
  setOpen: (nextOpen: boolean) => void,
  matchesShortcut: (event: KeyboardEvent) => boolean
) => {
  useKeyDown(
    window,
    useCallback(
      (event) => {
        if (!matchesShortcut(event)) return;
        if (!opened && hasBlockingPortalOverlay()) {
          return;
        }

        event.preventDefault();
        setOpen(!opened);
      },
      [matchesShortcut, opened, setOpen]
    )
  );
};
