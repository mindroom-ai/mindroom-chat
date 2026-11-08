import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Input, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { IMyDevice } from 'matrix-js-sdk';
import { CryptoEvent, type VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { getAccountManagementUrl } from '../useAccountManagement';
import { useServerConfigs } from '../../matrix/ServerConfigsLoader';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { AuthenticationCancelled, useAuthenticatedAction } from '../uia/useAuthenticatedAction';
import {
  countUnverifiedOtherDevices,
  type OwnDeviceTrust,
} from '../verification/useOwnDeviceTrust';
import { SecurityOverlay } from '../verification/SecurityOverlay';
import {
  VerificationRequestDialog,
  cancelPendingVerification,
} from '../verification/VerificationRequestDialog';
import { SecuritySettings } from './SecuritySettings';
import { ThisDeviceVerification } from './ThisDeviceVerification';
import { describeError, describeKnownError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

const TILE = 'featureUi.settings.devices.deviceTile';
const OTHERS = 'featureUi.settings.devices.otherDevices';
const TRUST = 'featureUi.settings.devices.verification';

const formatLastSeen = (device: IMyDevice, language: string): string | undefined => {
  if (!device.last_seen_ts) return undefined;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(device.last_seen_ts)
  );
};

/** The device list from `GET /devices`, newest activity first; `null` when it failed. */
const useDeviceList = () => {
  const client = useMatrixClient();
  const alive = useAlive();
  const [devices, setDevices] = useState<IMyDevice[] | null>();

  const reload = useCallback(async () => {
    try {
      const { devices: list } = await client.getDevices();
      if (!alive()) return;
      setDevices([...list].sort((a, b) => (b.last_seen_ts ?? 0) - (a.last_seen_ts ?? 0)));
    } catch {
      if (alive()) setDevices(null);
    }
  }, [client, alive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A session signed in or out elsewhere shows up in the account's device list updates.
  useEffect(() => {
    const ownUserId = client.getUserId();
    const onDevicesUpdated = (userIds: string[]) => {
      if (ownUserId && userIds.includes(ownUserId)) void reload();
    };
    client.on(CryptoEvent.DevicesUpdated, onDevicesUpdated);
    return () => {
      client.off(CryptoEvent.DevicesUpdated, onDevicesUpdated);
    };
  }, [client, reload]);

  return { devices, reload, setDevices };
};

/** Where the identity provider lets the person manage sessions, for delegated accounts. */
const useDeviceDashboardUrl = (): string | undefined => {
  const metadata = useServerConfigs().authMetadata;
  return metadata && getAccountManagementUrl(metadata, { action: 'org.matrix.devices_list' });
};

type RenameFormProps = {
  device: IMyDevice;
  onDone: (renamed: boolean) => void;
};

/** Edits a device's public display name. */
function RenameForm({ device, onDone }: RenameFormProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [draft, setDraft] = useState(device.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = draft.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name || name === device.display_name) return;
    setSaving(true);
    setFailed(false);
    client
      .setDeviceDetails(device.device_id, { display_name: name })
      .then(() => alive() && onDone(true))
      .catch(() => {
        if (!alive()) return;
        setFailed(true);
        setSaving(false);
      });
  };

  return (
    <Box as="form" direction="Column" gap="100" onSubmit={submit}>
      <Box gap="200" alignItems="Center">
        <Box grow="Yes" direction="Column">
          <Input
            aria-label={t(`${TILE}.deviceName`)}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            variant="Background"
            size="300"
            radii="300"
            autoFocus
          />
        </Box>
        <Button
          type="submit"
          size="300"
          radii="300"
          variant="Primary"
          fill="Soft"
          disabled={saving || !name || name === device.display_name}
          before={saving ? <Spinner size="50" variant="Primary" /> : undefined}
        >
          <Text size="B300">{t(`${TILE}.save`)}</Text>
        </Button>
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          disabled={saving}
          onClick={() => onDone(false)}
        >
          <Text size="B300">{t(`${TILE}.cancel`)}</Text>
        </Button>
      </Box>
      <Text size="T200" priority="300">
        {t(`${TILE}.deviceNamesAreVisibleToPublic`)}
      </Text>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain')}
        </Text>
      )}
    </Box>
  );
}

/** Whether cross-signing vouches for a session, as a badge after its name. */
function TrustBadge({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={verified ? 'Success' : 'Warning'}
      fill="Soft"
      radii="Pill"
      style={{ marginInlineStart: '0.5em', verticalAlign: 'middle' }}
    >
      <Text as="span" size="L400">
        {verified ? t(`${TRUST}.verified`) : t(`${TRUST}.unverified`)}
      </Text>
    </Badge>
  );
}

type DeviceRowProps = {
  /** The row's setting in the settings registry. */
  focusId: string;
  device: IMyDevice;
  current: boolean;
  /** Signs the device out; missing for this device, which signs out with Logout. */
  onSignOut?: () => void;
  signingOut?: boolean;
  onRenamed: () => void;
  /** Whether the session is verified; no badge while that cannot be told. */
  verified?: boolean;
  /** Starts an interactive verification with the session. */
  onVerify?: () => void;
  verifying?: boolean;
};

function DeviceRow(props: DeviceRowProps) {
  const {
    focusId,
    device,
    current,
    onSignOut,
    signingOut,
    onRenamed,
    verified,
    onVerify,
    verifying,
  } = props;
  const { t, i18n } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const lastSeen = formatLastSeen(device, i18n.language);
  const name = device.display_name || device.device_id;
  const details = [
    device.device_id,
    !current && lastSeen ? `${t(`${TILE}.lastActivity`)} ${lastSeen}` : undefined,
    device.last_seen_ip,
  ].filter(Boolean);

  const actions = (
    <Box gap="200" alignItems="Center">
      {onVerify && (
        <Button
          size="300"
          radii="300"
          variant="Primary"
          fill="Soft"
          disabled={verifying}
          aria-label={`${t(`${TRUST}.verify`)} ${name}`}
          before={verifying ? <Spinner size="50" variant="Primary" /> : undefined}
          onClick={onVerify}
        >
          <Text size="B300">{t(`${TRUST}.verify`)}</Text>
        </Button>
      )}
      <Button
        size="300"
        radii="300"
        variant="Secondary"
        fill="Soft"
        aria-label={`${t(`${TILE}.edit`)} ${name}`}
        aria-pressed={renaming}
        onClick={() => setRenaming((open) => !open)}
      >
        <Text size="B300">{t(`${TILE}.edit`)}</Text>
      </Button>
      {onSignOut && (
        <Button
          size="300"
          radii="300"
          variant="Critical"
          fill="Soft"
          disabled={signingOut}
          aria-label={`${t(`${TILE}.logout`)} ${name}`}
          before={signingOut ? <Spinner size="50" variant="Critical" /> : undefined}
          onClick={onSignOut}
        >
          <Text size="B300">{t(`${TILE}.logout`)}</Text>
        </Button>
      )}
    </Box>
  );

  return (
    <SettingTile
      focusId={focusId}
      title={
        <>
          {name}
          {verified !== undefined && <TrustBadge verified={verified} />}
        </>
      }
      description={details.join(' · ')}
      after={actions}
    >
      {renaming && (
        <RenameForm
          device={device}
          onDone={(renamed) => {
            setRenaming(false);
            if (renamed) onRenamed();
          }}
        />
      )}
    </SettingTile>
  );
}

/**
 * The account's encryption setup and sessions: this device first, then the others with rename
 * and sign out. Signing another device out asks for the password or single sign-on again.
 */
export function DeviceSettings({ trust }: { trust: OwnDeviceTrust | undefined }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const { devices, reload } = useDeviceList();
  const dashboardUrl = useDeviceDashboardUrl();
  const { run, prompt } = useAuthenticatedAction();
  const [signingOut, setSigningOut] = useState<string>();
  const [error, setError] = useState<{ during: 'verify' | 'signOut'; failure: unknown }>();
  const [verification, setVerification] = useState<VerificationRequest>();
  const [unlockedHere, setUnlockedHere] = useState(false);
  const [requestingFor, setRequestingFor] = useState<string>();
  const currentId = client.getDeviceId();
  const thisDevice = devices?.find((device) => device.device_id === currentId);
  const others = devices?.filter((device) => device.device_id !== currentId) ?? [];
  const unverifiedOthers = countUnverifiedOtherDevices(trust);

  /** Another session's badge: only a verified session can tell, and only for sessions with keys. */
  const otherTrust = (deviceId: string): boolean | undefined =>
    trust?.thisDeviceVerified ? trust.otherDevices.get(deviceId) : undefined;

  const verifyDevice = (deviceId: string) => {
    const crypto = client.getCrypto();
    const userId = client.getUserId();
    if (!crypto || !userId) return;
    setRequestingFor(deviceId);
    setError(undefined);
    crypto
      .requestDeviceVerification(userId, deviceId)
      .then((request) => alive() && setVerification(request))
      .catch((failure: unknown) => {
        if (alive()) setError({ during: 'verify', failure });
      })
      .finally(() => alive() && setRequestingFor(undefined));
  };

  const signOut = (deviceId: string) => {
    setSigningOut(deviceId);
    setError(undefined);
    run((auth) => client.deleteMultipleDevices([deviceId], auth))
      .then(() => reload())
      .catch((failure: unknown) => {
        if (!alive() || failure instanceof AuthenticationCancelled) return;
        setError({ during: 'signOut', failure });
      })
      .finally(() => alive() && setSigningOut(undefined));
  };

  let body: React.ReactNode;
  if (devices === undefined) {
    body = (
      <SettingsCard>
        <Spinner variant="Secondary" />
      </SettingsCard>
    );
  } else if (devices === null) {
    body = (
      <SettingsCard>
        <SettingTile
          title={t('featureUi.settings.devices.loadFailed')}
          after={
            <Button size="300" radii="300" fill="Soft" onClick={() => void reload()}>
              <Text size="B300">{t('sharedUi.clientRoot.retry')}</Text>
            </Button>
          }
        />
      </SettingsCard>
    );
  } else {
    body = (
      <>
        {thisDevice && (
          <Box direction="Column" gap="100">
            <Text size="L400" data-settings-heading="">
              {t('featureUi.settings.devices.current')}
            </Text>
            <SettingsCard>
              <DeviceRow
                focusId="currentSession"
                device={thisDevice}
                current
                onRenamed={() => void reload()}
                verified={trust?.crossSigning ? trust.thisDeviceVerified : undefined}
              />
              {/* Stays once an unlock started here, so the verified line and the restore progress keep showing. */}
              {trust?.crossSigning && (!trust.thisDeviceVerified || unlockedHere) && (
                <ThisDeviceVerification
                  onRequest={setVerification}
                  onUnlockStarted={() => setUnlockedHere(true)}
                  onUnlockFailed={() => setUnlockedHere(false)}
                />
              )}
            </SettingsCard>
          </Box>
        )}
        {others.length > 0 && (
          <Box direction="Column" gap="100">
            <Box alignItems="Center" gap="200" data-settings-heading="">
              <Text size="L400">{t(`${OTHERS}.others`)}</Text>
              {unverifiedOthers > 0 && (
                <Badge variant="Warning" fill="Soft" radii="Pill">
                  <Text as="span" size="L400">
                    {t(`${TRUST}.unverifiedCount`, { count: unverifiedOthers })}
                  </Text>
                </Badge>
              )}
            </Box>
            <SettingsCard>
              {others.map((device) => {
                const verified = otherTrust(device.device_id);
                return (
                  <DeviceRow
                    key={device.device_id}
                    focusId="otherSessions"
                    device={device}
                    current={false}
                    // Delegated accounts sign devices out at their identity provider.
                    onSignOut={dashboardUrl ? undefined : () => signOut(device.device_id)}
                    signingOut={signingOut === device.device_id}
                    onRenamed={() => void reload()}
                    verified={verified}
                    onVerify={verified === false ? () => verifyDevice(device.device_id) : undefined}
                    verifying={requestingFor === device.device_id}
                  />
                );
              })}
              {error && (
                <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                  {error.during === 'signOut'
                    ? t(`${OTHERS}.logoutFailed`, {
                        error: describeKnownError(t, error.failure) ?? '',
                      })
                    : describeError(t, error.failure)}
                  <ErrorDetail error={error.failure} />
                </Text>
              )}
            </SettingsCard>
          </Box>
        )}
      </>
    );
  }

  return (
    <>
      {trust && <SecuritySettings trust={trust} />}
      {dashboardUrl && (
        <Box direction="Column" gap="100">
          <Text size="L400" data-settings-heading="">
            {t(`${OTHERS}.deviceDashboard`)}
          </Text>
          <SettingsCard>
            <SettingTile
              title={t(`${OTHERS}.deviceDashboard`)}
              description={t(`${OTHERS}.manageYourDevicesOnOidcDashboard`)}
              after={
                <Button
                  as="a"
                  href={dashboardUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                >
                  <Text size="B300">{t(`${OTHERS}.open`)}</Text>
                </Button>
              }
            />
          </SettingsCard>
        </Box>
      )}
      {body}
      {prompt}
      {verification && (
        <SecurityOverlay
          onClose={() => {
            cancelPendingVerification(verification);
            setVerification(undefined);
          }}
        >
          <VerificationRequestDialog
            request={verification}
            onClose={() => setVerification(undefined)}
          />
        </SecurityOverlay>
      )}
    </>
  );
}
