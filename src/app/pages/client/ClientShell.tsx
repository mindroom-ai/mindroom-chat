import React, { ReactNode, useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  RoomsNotificationPreferencesProvider,
  useRoomsNotificationPreferences,
} from '../../hooks/useRoomsNotificationPreferences';
import { ClosedNavCategoriesProvider } from '../../state/hooks/closedNavCategories';
import { NavToActivePathProvider } from '../../state/hooks/navToActivePath';
import { makeClosedNavCategoriesAtom } from '../../state/closedNavCategories';
import { makeNavToActivePathAtom } from '../../state/navToActivePath';
import { useCrossRoomThreadIndex } from '../../mindroom/cross-room-threads/useCrossRoomThreadIndex';
import { useBindArchivedRoomsAtom } from '../../mindroom/rooms/archivedRooms';
import { SettingsModalRenderer } from '../../features/settings/SettingsModalRenderer';
import {
  CanvasIndexFeature,
  MindroomAccountSettingsFeature,
  MindroomInviteNotifications,
  MindroomNativeIOSPushFeature,
  MindroomNativeIOSPushOpenFeature,
} from '../../mindroom/client/MindroomClientNonUIFeatures';
import { ServerEmojiJoinFeature } from '../../mindroom/server-emoji/ServerEmojiJoinFeature';
import { CommandPaletteRenderer } from '../../mindroom/command-palette/CommandPaletteRenderer';

/** Account-wide work with no UI of its own: the cross-room thread index and archived rooms. */
function ClientIndexes() {
  const mx = useMatrixClient();
  useCrossRoomThreadIndex();
  useBindArchivedRoomsAtom(mx);
  return null;
}

/** Account-wide work without UI: indexes, account settings, invites, push and the emoji room. */
function ClientNonUIFeatures() {
  return (
    <>
      <ClientIndexes />
      <MindroomAccountSettingsFeature />
      <MindroomInviteNotifications />
      <CanvasIndexFeature />
      <MindroomNativeIOSPushFeature />
      <MindroomNativeIOSPushOpenFeature />
      <ServerEmojiJoinFeature />
    </>
  );
}

/** Per-account state the signed-in pages share, and the global dialogs. */
export function ClientShell({ children }: { children: ReactNode }) {




  const notificationPreferences = useRoomsNotificationPreferences();

  return (
    <ClosedNavCategoriesProvider value={closedNavCategoriesAtom}>
      <NavToActivePathProvider value={navToActivePathAtom}>
        <RoomsNotificationPreferencesProvider value={notificationPreferences}>
          <ClientNonUIFeatures />
          {children}
          <SettingsModalRenderer />
          <CommandPaletteRenderer />
        </RoomsNotificationPreferencesProvider>
      </NavToActivePathProvider>
    </ClosedNavCategoriesProvider>
  );
}
