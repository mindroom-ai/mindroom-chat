import React from 'react';
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
import { JoinedRoomThreadListsFeature } from './threads/JoinedRoomThreadListsFeature';

/**
 * Account-wide work without UI: indexes and the joined rooms' thread lists that fill them,
 * account settings, invites, message notifications and the count in the page title, push, the
 * emoji room, the bug report rooms an administrator joins without accepting their invites, and
 * agents' connect links, which open through the Connections portal signed in as this account.
 */
export function ClientNonUIFeatures() {
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <JoinedRoomThreadListsFeature />
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
