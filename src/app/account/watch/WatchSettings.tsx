import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text } from 'folds';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getWatchStatus,
  isNativeWatchAvailable,
  onWatchSignedIn,
  sendWatchCredentials,
  sendWatchSecrets,
  signOutWatch,
  type WatchDevice,
  type WatchStatus,
} from '../../native/nativeWatch';
import { AuthenticationCancelled, useAuthenticatedAction } from '../uia/useAuthenticatedAction';
import { connectWatch, verifyWatch } from './connectWatch';

const W = 'featureUi.watch';

/**
 * The accounts this app sent a watch a login token for, until the watch reports in: only a sign-in
 * this iPhone started gets verified and the account's secrets. Kept outside the component, so a
 * report that arrives while Settings was closed (the plugin keeps it) still counts when it reopens.
 */
const pendingConnects = new Set<string>();

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Step =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'waiting' }
  | { kind: 'verifying' }
  /** `retry`: verifying did not finish, so Verify is offered again. */
  | { kind: 'message'; text: string; retry?: boolean };

/** Hooks up the watch: mints its login, verifies its device when it reports in, disconnects it. */
function WatchSettingsSection() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { run, prompt } = useAuthenticatedAction();
  const [status, setStatus] = useState<WatchStatus>();
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  /** Whether the account has cross-signed the connected watch; a watch it has not gets Verify. */
  const [crossSigned, setCrossSigned] = useState<boolean>();
  const mounted = useRef(true);

  const refresh = useCallback(() => getWatchStatus().then(setStatus), []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const deviceId =
    status?.device?.userId === mx.getSafeUserId() ? status.device.deviceId : undefined;

  useEffect(() => {
    setCrossSigned(undefined);
    if (!deviceId) return undefined;
    let alive = true;
    void mx
      .getCrypto()
      ?.getDeviceVerificationStatus(mx.getSafeUserId(), deviceId)
      .then((verification) => {
        if (alive) setCrossSigned(!!verification?.crossSigningVerified);
      });
    return () => {
      alive = false;
    };
  }, [mx, deviceId]);

  /** Cross-signs the watch's device and sends it the account's secrets. */
  const verify = useCallback(
    async (watchDeviceId: string) => {
      setStep({ kind: 'verifying' });
      let result: Awaited<ReturnType<typeof verifyWatch>>;
      try {
        result = await verifyWatch(mx, watchDeviceId, sendWatchSecrets);
      } catch (error) {
        if (mounted.current)
          setStep({ kind: 'message', text: t(`${W}.failed`, { reason: describeError(error) }) });
        return;
      }
      if (!mounted.current) return;
      await refresh();
      if (result === 'no-cross-signing') {
        setStep({ kind: 'message', text: t(`${W}.noCrossSigning`) });
        return;
      }
      if (result !== 'timeout') setCrossSigned(true);
      if (result === 'verified') setStep({ kind: 'idle' });
      else if (result === 'no-backup')
        setStep({ kind: 'message', text: t(`${W}.noBackup`), retry: true });
      else setStep({ kind: 'message', text: t(`${W}.timeout`), retry: true });
    },
    [mx, refresh, t]
  );

  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    void onWatchSignedIn((device: WatchDevice) => {
      if (!alive || device.userId !== mx.getSafeUserId() || !pendingConnects.has(device.userId))
        return;
      pendingConnects.delete(device.userId);
      void verify(device.deviceId);
    }).then((remove) => {
      if (alive) stop = remove;
      else remove();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [mx, verify]);

  const connect = async () => {
    setStep({ kind: 'connecting' });
    const result = await connectWatch(mx, sendWatchCredentials, run);
    if (result.kind === 'sent') pendingConnects.add(mx.getSafeUserId());
    if (result.kind === 'sent') setStep({ kind: 'waiting' });
    else if (result.kind === 'cancelled') setStep({ kind: 'idle' });
    else if (result.kind === 'unsupported')
      setStep({ kind: 'message', text: t(`${W}.unsupported`) });
    else setStep({ kind: 'message', text: t(`${W}.failed`, { reason: result.reason }) });
  };

  /**
   * Signs the watch's device out on the server too, so a lost or unpaired watch, which never reads
   * the sign-out message, keeps no session (it holds the account's cross-signing and backup keys).
   */
  const disconnect = async (deviceId: string) => {
    try {
      await run((auth) => mx.deleteMultipleDevices([deviceId], auth));
    } catch (error) {
      if (error instanceof AuthenticationCancelled) return;
      setStep({ kind: 'message', text: t(`${W}.failed`, { reason: describeError(error) }) });
      return;
    }
    await signOutWatch();
    setStep({ kind: 'idle' });
    await refresh();
  };

  if (!status) return null;

  let description = t(`${W}.notConnected`);
  if (!status.paired) description = t(`${W}.noWatch`);
  else if (!status.installed) description = t(`${W}.notInstalled`);
  else if (step.kind === 'connecting') description = t(`${W}.connecting`);
  else if (step.kind === 'waiting') description = t(`${W}.waiting`);
  else if (step.kind === 'verifying') description = t(`${W}.verifying`);
  else if (step.kind === 'message') description = step.text;
  else if (deviceId) description = t(`${W}.connected`, { deviceId });

  const busy = step.kind === 'connecting' || step.kind === 'verifying';
  let action = null;
  // A remembered watch can always be disconnected: its device is deleted on the server even when the
  // watch is unpaired or gone.
  if (deviceId) {
    action = (
      <Box gap="200">
        {(crossSigned === false || (step.kind === 'message' && step.retry)) && (
          <Button
            size="300"
            radii="300"
            variant="Primary"
            fill="Soft"
            disabled={busy}
            before={busy ? <Spinner size="50" variant="Primary" /> : undefined}
            onClick={() => void verify(deviceId)}
          >
            <Text size="B300">{t(`${W}.verify`)}</Text>
          </Button>
        )}
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={() => void disconnect(deviceId)}
        >
          <Text size="B300">{t(`${W}.disconnect`)}</Text>
        </Button>
      </Box>
    );
  } else if (status.paired && status.installed) {
    action = (
      <Button
        size="300"
        radii="300"
        variant="Primary"
        fill="Soft"
        disabled={busy}
        before={busy ? <Spinner size="50" variant="Primary" /> : undefined}
        onClick={() => void connect()}
      >
        <Text size="B300">{t(`${W}.connect`)}</Text>
      </Button>
    );
  }

  return (
    <SettingsSection>
      <SettingTile
        focusId="appleWatch"
        title={t(`${W}.description`)}
        description={description}
        after={action}
      />
      {prompt}
    </SettingsSection>
  );
}

/** Settings → Apple Watch on the iOS app: connect an Apple Watch as a device of this account. */
export function AppleWatch({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  return (
    <SettingsPageFrame title={t(`${W}.title`)} requestClose={requestClose}>
      {isNativeWatchAvailable() && <WatchSettingsSection />}
    </SettingsPageFrame>
  );
}
