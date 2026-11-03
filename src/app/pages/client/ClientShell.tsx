import React, { ReactNode } from 'react';
import {
  RoomsNotificationPreferencesProvider,
  useRoomsNotificationPreferences,
} from '../../hooks/useRoomsNotificationPreferences';
import { SettingsModalRenderer } from '../../features/settings/SettingsModalRenderer';
import { CommandPaletteRenderer } from '../../mindroom/command-palette/CommandPaletteRenderer';
import { ClientInitStorageAtom } from './ClientInitStorageAtom';
import { ClientNonUIFeatures } from './ClientNonUIFeatures';

/** Per-account state the signed-in pages share, and the global dialogs. */
export function ClientShell({ children }: { children: ReactNode }) {
  const notificationPreferences = useRoomsNotificationPreferences();

  return (
    <ClientInitStorageAtom>
      <RoomsNotificationPreferencesProvider value={notificationPreferences}>
        <ClientNonUIFeatures />
        {children}
        <SettingsModalRenderer />
        <CommandPaletteRenderer />
      </RoomsNotificationPreferencesProvider>
    </ClientInitStorageAtom>
  );
}
