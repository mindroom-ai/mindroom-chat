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
import { BugReportAutoJoinFeature } from '../../mindroom/bug-reports/BugReportAutoJoinFeature';
import { AgentConnectLinkFeature } from '../../mindroom/connections/AgentConnectLinks';
import { MessageNotificationsFeature } from '../../mindroom/notifications/MessageNotifications';
import { UnreadTitleFeature } from '../../mindroom/notifications/UnreadTitle';

/** The archived rooms list, kept for the whole session. */
function ArchivedRoomsIndex() {
  useBindArchivedRoomsAtom(useMatrixClient());
  return null;
}

/**
 * Account-wide work without UI: indexes, account settings, invites, message notifications and
 * the count in the page title, push, the emoji room, the bug report rooms an administrator
 * joins without accepting their invites, and agents' connect links, which open through the
 * Connections portal signed in as this account.
 */
export function ClientNonUIFeatures() {
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <ArchivedRoomsIndex />
      <MindroomAccountSettingsFeature />
      <MindroomInviteNotifications />
      <MessageNotificationsFeature />
      <UnreadTitleFeature />
      <CanvasIndexFeature />
      <MindroomNativeIOSPushFeature />
      <MindroomNativeIOSPushOpenFeature />
      <ServerEmojiJoinFeature />
      <BugReportAutoJoinFeature />
      <AgentConnectLinkFeature />
    </>
  );
}
