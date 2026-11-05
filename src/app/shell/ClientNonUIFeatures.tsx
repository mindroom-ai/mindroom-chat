import {
  CanvasIndexFeature,
  CrossRoomThreadIndexFeature,
  MindroomInviteNotifications,
  MindroomNativeIOSPushFeature,
  MindroomNativeIOSPushOpenFeature,
} from './ClientFeatures';
import { ServerEmojiJoinFeature } from '../emoji/server/ServerEmojiJoinFeature';
import { BugReportAutoJoinFeature } from '../bug-reports/BugReportAutoJoinFeature';
import { AgentConnectLinkFeature } from '../connections/AgentConnectLinks';
import { MessageNotificationsFeature } from '../notifications/MessageNotifications';
import { UnreadTitleFeature } from '../notifications/UnreadTitle';
import { JoinedRoomThreadListsFeature } from '../threads/page/JoinedRoomThreadListsFeature';
import { ErrorReportingClientFeature } from '../bug-reports/error-reporting/errorReporting';

/**
 * Account-wide work without UI: indexes and the joined rooms' thread lists that fill them,
 * invites, message notifications and the count in the page title, push, the emoji room, the bug
 * report rooms an administrator joins without accepting their invites, agents' connect links,
 * which open through the Connections portal signed in as this account, and the error reports of
 * sync, decryption and send failures when the deployment collects them. The account's MindRoom
 * settings are seeded behind the `ClientBindAtoms` gate instead, since the first render reads them.
 */
export function ClientNonUIFeatures() {
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <JoinedRoomThreadListsFeature />
      <MindroomInviteNotifications />
      <MessageNotificationsFeature />
      <UnreadTitleFeature />
      <CanvasIndexFeature />
      <MindroomNativeIOSPushFeature />
      <MindroomNativeIOSPushOpenFeature />
      <ServerEmojiJoinFeature />
      <BugReportAutoJoinFeature />
      <AgentConnectLinkFeature />
      <ErrorReportingClientFeature />
    </>
  );
}
