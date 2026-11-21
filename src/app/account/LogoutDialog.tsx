import { CSSProperties, forwardRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import { Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import { Dialog, Header, IconButton } from '../ui/glass/GlassPrimitives';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { createSessionRequestClient, logoutStoredSession } from './lifecycle/initMatrix';
import { logoutClient } from './lifecycle/sessionLifecycle';
import { setActiveSession, type StoredSession } from '../matrix/session/sessions';
import { isJoined } from '../matrix/state/roomList';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { getRecentRoomsAtom } from '../navigation/recentRooms';
import { getHomeRoomPath, withSearchParam } from '../routes/pathUtils';
import { resolveSessionRestorePath } from '../routes/sessionRouteRestore';
import {
  getRoomInputVoiceSendContext,
  confirmedVoiceThreadId,
} from '../composer/RoomInputExtensions';
import {
  allowVoiceDraftRestore,
  readSavedVoiceDraft,
  restoreSavedVoiceDraft,
} from '../composer/voice/savedVoiceDraft';
import {
  discardUnsentVoice,
  hasUnsentVoice,
  liveVoiceRecordingFor,
  pendingVoiceDraftFor,
} from '../composer/voice/unsentVoice';
import { ContainerColor } from '../ui/styles/ContainerColor.css';
import { describeKnownError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';

type EncryptionRisk = 'none' | 'unverified-device' | 'no-verification';

/**
 * What logging out costs this device: messages it alone can decrypt are lost when cross-signing
 * is not set up, or when this device is not verified and so holds keys nobody else has.
 */
const getEncryptionRisk = async (client: MatrixClient): Promise<EncryptionRisk> => {
  const crypto = client.getCrypto();
  const userId = client.getUserId();
  const deviceId = client.getDeviceId();
  if (!crypto || !userId || !deviceId) return 'none';
  if (!(await crypto.isCrossSigningReady())) return 'no-verification';
  const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
  return status?.crossSigningVerified ? 'none' : 'unverified-device';
};

/**
 * The same for an account that is not active, whose crypto store stays closed: from the keys the
 * homeserver holds for it. Its device counts as verified when the account's self-signing key
 * signed it. Without an answer, the warning stays.
 */
const getStoredSessionEncryptionRisk = async (session: StoredSession): Promise<EncryptionRisk> => {
  const { userId, deviceId } = session;
  try {
    const keys = await createSessionRequestClient(session).downloadKeysForUsers([userId]);
    const selfSigningKeyIds = Object.keys(keys.self_signing_keys?.[userId]?.keys ?? {});
    if (selfSigningKeyIds.length === 0) return 'no-verification';
    const signatures = keys.device_keys[userId]?.[deviceId]?.signatures?.[userId] ?? {};
    return selfSigningKeyIds.some((keyId) => keyId in signatures) ? 'none' : 'unverified-device';
  } catch {
    return 'no-verification';
  }
};

type LogoutDialogProps = {
  handleClose: () => void;
  onShowRecording?: () => void;
  /** An account other than the active one, to log out instead of the active one. */
  session?: StoredSession;
};

const RISK_PANEL_SHAPE: CSSProperties = {
  borderRadius: config.radii.R400,
  padding: config.space.S300,
};

/**
 * Confirms logging out, warning first when this device holds the only copy of message keys.
 * The ref reaches the dialog element, so a focus trap around it knows what counts as inside.
 */
export const LogoutDialog = forwardRef<HTMLDivElement, LogoutDialogProps>(function LogoutDialog(
  { handleClose, onShowRecording, session },
  ref
) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const store = useStore();
  const userId = session?.userId ?? client.getUserId();
  const selectedRoomId = useSelectedRoom();
  const { navigatePath, navigateRoom, navigateRoomThread } = useRoomNavigate();
  const [unsentVoice, setUnsentVoice] = useState<boolean>();
  const [risk, setRisk] = useState<EncryptionRisk>('none');
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<{ logoutError: unknown }>();

  useEffect(() => {
    let current = true;
    (session ? getStoredSessionEncryptionRisk(session) : getEncryptionRisk(client)).then(
      (next) => {
        if (current) setRisk(next);
      },
      () => undefined
    );
    void (userId ? hasUnsentVoice(store, userId) : Promise.resolve(false)).then((unsent) => {
      if (current) setUnsentVoice(unsent);
    });
    return () => {
      current = false;
    };
  }, [client, session, store, userId]);

  const showRecording = async () => {
    if (!userId || loggingOut) return;
    setLoggingOut(true);
    try {
      if (session && session.userId !== client.getUserId()) {
        const saved = await readSavedVoiceDraft(userId);
        if (!alive()) return;
        const roomId = saved?.roomId ?? store.get(getRecentRoomsAtom(userId))[0]?.roomId;
        allowVoiceDraftRestore(userId);
        if (!setActiveSession(session.sessionId)) return;
        navigatePath(
          roomId
            ? withSearchParam(getHomeRoomPath(encodeURIComponent(roomId)), {
                threadId: saved?.threadId,
              })
            : resolveSessionRestorePath(session.lastKnownPath)
        );
      } else if (!liveVoiceRecordingFor(store, userId)) {
        const selected = selectedRoomId ? client.getRoom(selectedRoomId) : null;
        const current =
          selected && isJoined(selected) && !selected.isSpaceRoom() ? selected : undefined;
        const room =
          current ?? client.getRooms().find((item) => isJoined(item) && !item.isSpaceRoom());
        if (!pendingVoiceDraftFor(store, userId)) {
          await restoreSavedVoiceDraft(
            client,
            store,
            userId,
            room &&
              (() =>
                getRoomInputVoiceSendContext({
                  ownerSessionId: userId,
                  room,
                  roomId: room.roomId,
                  threadId: undefined,
                  replyDraft: undefined,
                }))
          );
        }
        if (!alive()) return;
        const draft = pendingVoiceDraftFor(store, userId);
        if (draft && !draft.recovered) {
          const { roomId, threadId } = draft.context;
          const confirmed = confirmedVoiceThreadId(draft.context.room, threadId);
          if (confirmed) navigateRoomThread(roomId, confirmed);
          else if (roomId !== current?.roomId) navigateRoom(roomId);
        } else if (room && !current) navigateRoom(room.roomId);
      }
      handleClose();
      onShowRecording?.();
    } finally {
      if (alive()) setLoggingOut(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut || unsentVoice === undefined) return;
    setLoggingOut(true);
    setError(undefined);
    try {
      if (userId && unsentVoice) await discardUnsentVoice(store, userId);
      else if (userId && (await hasUnsentVoice(store, userId))) {
        if (alive()) {
          setUnsentVoice(true);
          setLoggingOut(false);
        }
        return;
      }
      if (!unsentVoice && !alive()) return;
      if (session) {
        await logoutStoredSession(session);
        if (alive()) handleClose();
      } else {
        await logoutClient(client);
      }
    } catch (logoutError) {
      if (!alive()) return;
      setError({ logoutError });
      setLoggingOut(false);
    }
  };

  return (
    <Dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-dialog-title"
      variant="Surface"
    >
      <Header
        size="500"
        style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
      >
        <Box grow="Yes">
          <Text id="logout-dialog-title" size="H4">
            {t(
              unsentVoice
                ? 'sharedUi.logoutDialog.unsentVoiceTitle'
                : 'sharedUi.logoutDialog.logout'
            )}
          </Text>
        </Box>
        <IconButton
          size="300"
          radii="300"
          onClick={handleClose}
          aria-label={t('sharedUi.logoutDialog.cancel')}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box direction="Column" gap="400" style={{ padding: config.space.S400, paddingTop: 0 }}>
        {risk !== 'none' && (
          <Box
            className={ContainerColor({ variant: 'Warning' })}
            style={RISK_PANEL_SHAPE}
            gap="100"
            direction="Column"
          >
            <Box alignItems="Center" gap="200">
              <Icon size="100" src={Icons.Warning} filled />
              <Text size="L400">
                {risk === 'unverified-device'
                  ? t('sharedUi.logoutDialog.unverifiedDevice')
                  : t('sharedUi.logoutDialog.alert')}
              </Text>
            </Box>
            <Text size="T200">
              {risk === 'unverified-device'
                ? t(
                    'sharedUi.logoutDialog.verifyYourDeviceBeforeLoggingOutToSaveYourEncryptedMessages'
                  )
                : t(
                    'sharedUi.logoutDialog.enableDeviceVerificationOrExportYourEncryptedDataFromSettingsToAvoid'
                  )}
            </Text>
          </Box>
        )}
        <Box direction="Column" gap="100">
          <Text priority="400">
            {t(
              unsentVoice
                ? 'sharedUi.logoutDialog.unsentVoiceBody'
                : 'sharedUi.logoutDialog.youReAboutToLogOutAreYouSure'
            )}
          </Text>
          {session && (
            <Text size="T300" priority="300" style={{ overflowWrap: 'anywhere' }}>
              {session.userId}
            </Text>
          )}
        </Box>
        {error && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            <b>
              {t('sharedUi.logoutDialog.logoutFailed', {
                error: describeKnownError(t, error.logoutError) ?? '',
              })}
            </b>
            <ErrorDetail error={error.logoutError} />
          </Text>
        )}
        <Box direction="Column" gap="200">
          {unsentVoice && (
            <Button
              variant="Primary"
              disabled={loggingOut}
              onClick={() => void showRecording().catch(() => undefined)}
            >
              <Text size="B400">{t('sharedUi.logoutDialog.sendUnsentVoice')}</Text>
            </Button>
          )}
          <Button
            variant="Critical"
            onClick={() => void handleLogout()}
            disabled={loggingOut || unsentVoice === undefined}
            before={loggingOut ? <Spinner variant="Critical" fill="Solid" size="200" /> : undefined}
          >
            <Text size="B400">
              {t(
                unsentVoice
                  ? 'sharedUi.logoutDialog.discardVoiceAndSignOut'
                  : 'sharedUi.logoutDialog.logout'
              )}
            </Text>
          </Button>
          <Button variant="Secondary" fill="Soft" onClick={handleClose} disabled={loggingOut}>
            <Text size="B400">{t('sharedUi.logoutDialog.cancel')}</Text>
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
});
