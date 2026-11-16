import { useMemo } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMxIdLocalPart } from '../matrix/matrix';
import { isMacOS } from '../lib/user-agent';
import { getCommandPaletteShortcutLabel } from '../shortcuts/paletteShortcut';
import type { SettingsSearchValues } from './settingsSearchIndex';

/** The values some labels and descriptions fill in, so search reads them as the page does. */
export const useSettingsSearchValues = (): SettingsSearchValues => {
  const userId = useMatrixClient().getUserId() ?? '';
  return useMemo(
    () => ({
      userId,
      username: getMxIdLocalPart(userId) ?? userId,
      sendKey: isMacOS() ? 'Cmd' : 'Ctrl',
      shortcut: getCommandPaletteShortcutLabel(),
    }),
    [userId]
  );
};
