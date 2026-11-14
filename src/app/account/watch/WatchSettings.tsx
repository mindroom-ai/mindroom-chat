import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, Text } from 'folds';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsSection } from '../../ui/settings/SettingsSection';
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
import { useAuthenticatedAction } from '../uia/useAuthenticatedAction';
import { connectWatch, verifyWatch } from './connectWatch';

const W = 'featureUi.watch';

type Step =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'waiting' }
  | { kind: 'verifying' }
  | { kind: 'message'; text: string };

/** Hooks up the watch: mints its login, verifies its device when it reports in, disconnects it. */
function WatchSettingsSection() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { run, prompt } = useAuthenticatedAction();
  const [status, setStatus] = useState<WatchStatus>();
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  const refresh = useCallback(() => getWatchStatus().then(setStatus), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    const verify = async (device: WatchDevice) => {
      if (!alive || device.userId !== mx.getSafeUserId()) return;
      setStep({ kind: 'verifying' });
      const result = await verifyWatch(mx, device.deviceId, sendWatchSecrets);
      if (!alive) return;
      await refresh();
      if (result === 'verified') setStep({ kind: 'idle' });
      else if (result === 'no-backup') setStep({ kind: 'message', text: t(`${W}.noBackup`) });
      else if (result === 'no-cross-signing')
        setStep({ kind: 'message', text: t(`${W}.noCrossSigning`) });
      else setStep({ kind: 'message', text: t(`${W}.timeout`) });
    };
    void onWatchSignedIn((device) => {
      void verify(device);
    }).then((remove) => {
      if (alive) stop = remove;
      else remove();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [mx, refresh, t]);

  const connect = async () => {
    setStep({ kind: 'connecting' });
    const result = await connectWatch(mx, sendWatchCredentials, run);
    if (result.kind === 'sent') setStep({ kind: 'waiting' });
    else if (result.kind === 'cancelled') setStep({ kind: 'idle' });
    else if (result.kind === 'unsupported')
      setStep({ kind: 'message', text: t(`${W}.unsupported`) });
    else setStep({ kind: 'message', text: t(`${W}.failed`, { reason: result.reason }) });
  };

  const disconnect = async () => {
    await signOutWatch();
    setStep({ kind: 'idle' });
    await refresh();
  };

  if (!status) return null;

  const device = status.device?.userId === mx.getSafeUserId() ? status.device : undefined;
  let description = t(`${W}.notConnected`);
  if (!status.paired) description = t(`${W}.noWatch`);
  else if (!status.installed) description = t(`${W}.notInstalled`);
  else if (step.kind === 'connecting') description = t(`${W}.connecting`);
  else if (step.kind === 'waiting') description = t(`${W}.waiting`);
  else if (step.kind === 'verifying') description = t(`${W}.verifying`);
  else if (step.kind === 'message') description = step.text;
  else if (device) description = t(`${W}.connected`, { deviceId: device.deviceId });

  const busy = step.kind === 'connecting' || step.kind === 'verifying';
  let action = null;
  if (status.paired && status.installed) {
    action = device ? (
      <Button
        size="300"
        radii="300"
        variant="Secondary"
        fill="Soft"
        onClick={() => void disconnect()}
      >
        <Text size="B300">{t(`${W}.disconnect`)}</Text>
      </Button>
    ) : (
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
    <SettingsSection title={t(`${W}.title`)}>
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

/** Settings → Privacy on the iOS app: connect an Apple Watch as a device of this account. */
export function WatchSettings() {
  if (!isNativeWatchAvailable()) return null;
  return <WatchSettingsSection />;
}
