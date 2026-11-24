import { useEffect } from 'react';
import { useStore } from 'jotai';
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
import { useOptionalClientConfig, type ClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { createSessionId } from '../matrix/session/sessions';
import { hasDictationJournalRecord } from '../composer/capture/captureJournal';
import { captureAccountGuard } from '../composer/capture/liveCapture';
import { keepEncryptedRoomTextOffDisk } from '../matrix/client/encryptedRoomTextOffDisk';
import { forgetEncryptedRecentThreadText } from '../event-store/threads/recentThreads';
import { forgetEncryptedReplyText } from '../composer/roomInputDrafts';
import { UnconfirmedRootsFeature } from '../composer/UnconfirmedRootsFeature';
import { QuickCaptureHost } from '../quick-capture/QuickCaptureHost';
import { WatchHandoffFeature } from '../account/watch/WatchHandoffFeature';

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

const EMPTY_CLIENT_CONFIG: ClientConfig = {};

/**
 * Checks whether the signed-in account has a persisted dictation journal and lazily imports
 * dictation recovery only when one exists, surfacing a recovered dictation pill/capsule even when
 * reloading directly into Settings, Threads, or Home without pulling capture/VAD code into the
 * shell bundle.
 */
export function DictationRecoveryFeature() {
  const mx = useMatrixClient();
  const store = useStore();
  const clientConfig = useOptionalClientConfig() ?? EMPTY_CLIENT_CONFIG;
  const userId = mx.getUserId() ?? undefined;
  const baseUrl = typeof mx.getHomeserverUrl === 'function' ? mx.getHomeserverUrl() : mx.baseUrl;
  const sessionId = userId && baseUrl ? createSessionId(baseUrl, userId) : userId;

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    const sameAccount = captureAccountGuard(store);
    void hasDictationJournalRecord(sessionId)
      .then((hasRecord) => {
        if (cancelled || !hasRecord || !sameAccount()) return undefined;
        return import('../composer/dictation/startLiveDictation').then(
          ({ recoverDictationForAccount }) => {
            if (cancelled || !sameAccount()) return undefined;
            return recoverDictationForAccount(store, mx, clientConfig);
          }
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientConfig, mx, sessionId, store]);

  return null;
}

/**
 * Account-wide work without UI: indexes and the joined rooms' thread lists that fill them, the
 * threads' titles, invites, message notifications and the count in the page title, push, the emoji room, the bug
 * report rooms an administrator joins without accepting their invites, agents' connect links,
 * which open through the Connections portal signed in as this account, and the error reports of
 * sync, decryption and send failures when the deployment collects them, no text of the
 * encrypted rooms in the account's stores on disk, and the quick capture widget's host
 * (`QuickCaptureHost`), which serves the widget from this client, and the threads the Apple Watch
 * hands off (`WatchHandoffFeature`). The account's MindRoom
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
      <DictationRecoveryFeature />
      <QuickCaptureHost />
      <WatchHandoffFeature />
    </>
  );
}
