import React from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCrossRoomThreadIndex } from '../../mindroom/cross-room-threads/useCrossRoomThreadIndex';
import { useBindArchivedRoomsAtom } from '../../mindroom/rooms/archivedRooms';
import {
  CanvasIndexFeature,
  MindroomAccountSettingsFeature,
  MindroomInviteNotifications,
  MindroomNativeIOSPushFeature,
  MindroomNativeIOSPushOpenFeature,
} from '../../mindroom/client/MindroomClientNonUIFeatures';
import { ServerEmojiJoinFeature } from '../../mindroom/server-emoji/ServerEmojiJoinFeature';

/** The cross-room thread index and the archived rooms list, kept for the whole session. */
function ClientIndexes() {
  const mx = useMatrixClient();
  useCrossRoomThreadIndex();
  useBindArchivedRoomsAtom(mx);
  return null;
}

/** Account-wide work without UI: indexes, account settings, invites, push and the emoji room. */
export function ClientNonUIFeatures() {
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
