import { useEffect } from 'react';
import { CanvasIndexFeature } from '../canvas/CanvasIndexFeature';
import { CrossRoomThreadIndexFeature } from '../threads/cross-room/CrossRoomThreadIndexFeature';
import { ActivityRowsFeature } from '../activity/ActivityRowsFeature';
import { ThreadTitlesFeature } from '../threads/summary/ThreadTitlesFeature';
import { InviteNotifications } from '../notifications/InviteNotifications';
import {
  NativeIOSPushFeature,
  NativeIOSPushOpenFeature,
} from '../notifications/push/IOSPushFeature';
import { ServerEmojiJoinFeature } from '../emoji/server/ServerEmojiJoinFeature';
import { BugReportAutoJoinFeature } from '../bug-reports/BugReportAutoJoinFeature';
import { AgentConnectLinkFeature } from '../connections/AgentConnectLinks';
import { MessageNotificationsFeature } from '../notifications/MessageNotifications';
import { UnreadTitleFeature } from '../notifications/UnreadTitle';
import { JoinedRoomThreadListsFeature } from '../threads/page/JoinedRoomThreadListsFeature';
import { ErrorReportingClientFeature } from '../bug-reports/error-reporting/errorReporting';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { keepEncryptedRoomTextOffDisk } from '../matrix/client/encryptedRoomTextOffDisk';
import { forgetEncryptedRecentThreadText } from '../event-store/threads/recentThreads';
import { forgetEncryptedReplyText } from '../composer/roomInputDrafts';
import { UnconfirmedRootsFeature } from '../composer/UnconfirmedRootsFeature';

/** The account's stores keep no text read out of its encrypted rooms. */
function EncryptedRoomTextOffDiskFeature() {
  const mx = useMatrixClient();
  useEffect(
    () =>
      keepEncryptedRoomTextOffDisk(mx, [forgetEncryptedRecentThreadText, forgetEncryptedReplyText]),
    [mx]
  );
  return null;
}

/**
 * Account-wide work without UI: indexes and the joined rooms' thread lists that fill them, the
 * threads' titles, invites, message notifications and the count in the page title, push, the emoji room, the bug
 * report rooms an administrator joins without accepting their invites, agents' connect links,
 * which open through the Connections portal signed in as this account, and the error reports of
 * sync, decryption and send failures when the deployment collects them, and no text of the
 * encrypted rooms in the account's stores on disk. The account's MindRoom
 * settings are seeded behind the `ClientBindAtoms` gate instead, since the first render reads them.
 */
export function ClientNonUIFeatures() {
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <ActivityRowsFeature />
      <ThreadTitlesFeature />
      <JoinedRoomThreadListsFeature />
      <InviteNotifications />
      <MessageNotificationsFeature />
      <UnreadTitleFeature />
      <CanvasIndexFeature />
      <NativeIOSPushFeature />
      <NativeIOSPushOpenFeature />
      <ServerEmojiJoinFeature />
      <BugReportAutoJoinFeature />
      <AgentConnectLinkFeature />
      <ErrorReportingClientFeature />
      <EncryptedRoomTextOffDiskFeature />
      <UnconfirmedRootsFeature />
    </>
  );
}
