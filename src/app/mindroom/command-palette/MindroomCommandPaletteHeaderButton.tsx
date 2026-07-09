import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text, Tooltip, TooltipProvider } from 'folds';
import { useSetAtom } from 'jotai';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { commandPaletteOpenAtom } from './commandPaletteState';

export function MindroomCommandPaletteHeaderButton() {
  const { t } = useTranslation();
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const simpleMode = useSimpleMode();
  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, [setCommandPaletteOpen]);
  if (simpleMode) return null;

  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text>{t('commandPalette.open')}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onClick={handleOpenCommandPalette}
          aria-label={t('commandPalette.open')}
        >
          <Icon size="400" src={Icons.Terminal} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}
