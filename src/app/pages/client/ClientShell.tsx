import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { autoDiscovery, type AutoDiscoveryInfo } from '../../cs-api';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import {
  RoomsNotificationPreferencesProvider,
  useRoomsNotificationPreferences,
} from '../../hooks/useRoomsNotificationPreferences';
import { SettingsModalRenderer } from '../../features/settings/SettingsModalRenderer';
import { RoomSettingsRenderer } from '../../features/room-settings/RoomSettingsRenderer';
import { SpaceSettingsRenderer } from '../../features/space-settings/SpaceSettingsRenderer';
import { CreateRoomModalRenderer } from '../../features/create-room/CreateRoomModal';
import { CreateSpaceModalRenderer } from '../../features/create-space/CreateSpaceModal';
import { UserRoomProfileRenderer } from '../../components/user-profile/UserRoomProfileRenderer';
import { CommandPaletteRenderer } from '../../mindroom/command-palette/CommandPaletteRenderer';
import { IncomingVerificationRequests } from '../../components/device-verification/IncomingVerificationRequests';
import { ClientInitStorageAtom } from './ClientInitStorageAtom';
import { ClientNonUIFeatures } from './ClientNonUIFeatures';

/**
 * The `/.well-known/matrix/client` document of the account's server name, for the MindRoom
 * keys it carries (such as the emoji room). The signed-in client already knows its homeserver,
 * so `m.homeserver` always names the client's base URL, and the shell renders with only that
 * until the document arrives, or when the server publishes none.
 */
const useSessionDiscoveryInfo = (mx: MatrixClient): AutoDiscoveryInfo => {
  const [wellKnown, setWellKnown] = useState<AutoDiscoveryInfo>();
  const serverName = mx.getDomain();
  useEffect(() => {
    setWellKnown(undefined);
    if (!serverName) return undefined;
    let cancelled = false;
    autoDiscovery(createMatrixFetchFn(fetch), serverName).then(([, info]) => {
      if (!cancelled && info) setWellKnown(info);
    });
    return () => {
      cancelled = true;
    };
  }, [serverName]);
  return useMemo(
    () => ({ ...wellKnown, 'm.homeserver': { base_url: mx.baseUrl } }),
    [wellKnown, mx.baseUrl]
  );
};

/** Per-account state the signed-in pages share, and the global dialogs. */
export function ClientShell({ children }: { children: ReactNode }) {
  const notificationPreferences = useRoomsNotificationPreferences();
  const discoveryInfo = useSessionDiscoveryInfo(useMatrixClient());

  return (
    <AutoDiscoveryInfoProvider value={discoveryInfo}>
      <ClientInitStorageAtom>
        <RoomsNotificationPreferencesProvider value={notificationPreferences}>
          <ClientNonUIFeatures />
          {children}
          <SettingsModalRenderer />
          <RoomSettingsRenderer />
          <SpaceSettingsRenderer />
          <CreateRoomModalRenderer />
          <CreateSpaceModalRenderer />
          <CommandPaletteRenderer />
          <UserRoomProfileRenderer />
          <IncomingVerificationRequests />
        </RoomsNotificationPreferencesProvider>
      </ClientInitStorageAtom>
    </AutoDiscoveryInfoProvider>
  );
}
