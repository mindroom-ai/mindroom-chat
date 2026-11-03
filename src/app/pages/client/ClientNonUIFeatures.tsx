import React from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useBindArchivedRoomsAtom } from '../../mindroom/rooms/archivedRooms';
import {
  CanvasIndexFeature,
  CrossRoomThreadIndexFeature,
  MindroomAccountSettingsFeature,
  MindroomInviteNotifications,
  MindroomNativeIOSPushFeature,
  MindroomNativeIOSPushOpenFeature,
} from '../../mindroom/client/MindroomClientNonUIFeatures';
import { ServerEmojiJoinFeature } from '../../mindroom/server-emoji/ServerEmojiJoinFeature';

/** The archived rooms list, kept for the whole session. */
function ArchivedRoomsIndex() {
  useBindArchivedRoomsAtom(useMatrixClient());
  return null;
}

/** Account-wide work without UI: indexes, account settings, invites, push and the emoji room. */
export function ClientNonUIFeatures() {
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <ArchivedRoomsIndex />
      <MindroomAccountSettingsFeature />
      <MindroomInviteNotifications />
      <CanvasIndexFeature />
      <MindroomNativeIOSPushFeature />
      <MindroomNativeIOSPushOpenFeature />
      <ServerEmojiJoinFeature />
    </>
  );
}
