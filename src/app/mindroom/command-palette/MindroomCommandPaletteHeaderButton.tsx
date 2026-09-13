import React, { useCallback } from 'react';
import { Icon, IconButton, Icons, Text, Tooltip, TooltipProvider } from 'folds';
import { useSetAtom } from 'jotai';
import { commandPaletteOpenAtom } from './commandPaletteState';

export function MindroomCommandPaletteHeaderButton() {
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, [setCommandPaletteOpen]);

  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text>Open command palette</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onClick={handleOpenCommandPalette}
          aria-label="Open command palette"
        >
          <Icon size="400" src={Icons.Terminal} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}
