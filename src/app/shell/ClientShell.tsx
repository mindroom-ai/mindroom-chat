import { ReactNode, useEffect, useMemo, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { autoDiscovery, type AutoDiscoveryInfo } from '../matrix/cs-api';
import { AutoDiscoveryInfoProvider } from '../matrix/hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { createMatrixFetchFn } from '../matrix/client/matrixClientFactory';
import {
  RoomsNotificationPreferencesProvider,
  useRoomsNotificationPreferences,
} from '../matrix/hooks/useRoomsNotificationPreferences';
import { SettingsModalRenderer } from '../settings/SettingsModalRenderer';
import { RoomSettingsRenderer } from '../rooms/settings/RoomSettingsRenderer';
import { SpaceSettingsRenderer } from '../spaces/SpaceSettingsRenderer';
import { CreateRoomModalRenderer } from '../rooms/create/CreateRoomModal';
import { CreateSpaceModalRenderer } from '../spaces/create/CreateSpaceModal';
import { UserRoomProfileRenderer } from '../members/profile/UserRoomProfileRenderer';
import { CommandPaletteRenderer } from '../command-palette/CommandPaletteRenderer';
import { ShortcutRoot } from './shortcuts/ShortcutRoot';
import { EncryptionRecoveryPrompt } from '../account/encryption/EncryptionRecoveryPrompt';
import { RecoveryDialogRenderer } from '../account/encryption/RecoveryDialogRenderer';
import { IncomingVerificationRequests } from '../account/verification/IncomingVerificationRequests';
import { CallFeatures } from '../calls/CallFeatures';
import { ClientInitStorageAtom } from './ClientInitStorageAtom';
import { ClientNonUIFeatures } from './ClientNonUIFeatures';
import { SkipToContent } from './SkipToContent';

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
    void autoDiscovery(createMatrixFetchFn(fetch), serverName).then(([, info]) => {
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

/** Per-account state the signed-in pages share, the global dialogs, and calls. */
export function ClientShell({ children }: { children: ReactNode }) {
  const notificationPreferences = useRoomsNotificationPreferences();
  const discoveryInfo = useSessionDiscoveryInfo(useMatrixClient());

  return (
    <AutoDiscoveryInfoProvider value={discoveryInfo}>
      <ClientInitStorageAtom>
        <RoomsNotificationPreferencesProvider value={notificationPreferences}>
          <ClientNonUIFeatures />
          <SkipToContent />
          {children}
          <SettingsModalRenderer />
          <RoomSettingsRenderer />
          <SpaceSettingsRenderer />
          <CreateRoomModalRenderer />
          <CreateSpaceModalRenderer />
          <CommandPaletteRenderer />
          <ShortcutRoot />
          <UserRoomProfileRenderer />
          <IncomingVerificationRequests />
          <RecoveryDialogRenderer />
          <EncryptionRecoveryPrompt />
          <CallFeatures />
        </RoomsNotificationPreferencesProvider>
      </ClientInitStorageAtom>
    </AutoDiscoveryInfoProvider>
  );
}
