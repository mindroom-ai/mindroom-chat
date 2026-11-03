import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Spinner, Text, color } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { SettingsPageFrame } from '../../features/settings/SettingsPageFrame';
import { SequenceCardStyle } from '../../features/settings/styles.css';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getConnectPath } from '../../pages/pathUtils';
import {
  getLocalMindroomConnections,
  getLocalMindroomErrorMessage,
  type LocalMindroomConnection,
  revokeLocalMindroomConnection,
} from './api';
import {
  formatLocalTimestamp,
  getConnectionId,
  getConnectionLastSeenAt,
  getConnectionName,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
} from './mindroom';
import { PairCodeForm } from './PairCodeForm';

const RUN_COMMAND = 'uvx mindroom run';

type Connections =
  | { status: 'loading' }
  | { status: 'ready'; connections: LocalMindroomConnection[] }
  | { status: 'error'; message: string };

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

type ConnectionRowProps = {
  connection: LocalMindroomConnection;
  index: number;
  onRevoke: (connectionId: string) => Promise<void>;
};

function ConnectionRow({ connection, index, onRevoke }: ConnectionRowProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [failed, setFailed] = useState(false);
  const connectionId = getConnectionId(connection);
  const lastSeen = getConnectionLastSeenAt(connection);

  const revoke = () => {
    if (!connectionId) return;
    setRevoking(true);
    setFailed(false);
    onRevoke(connectionId)
      .catch(() => setFailed(true))
      .finally(() => {
        setRevoking(false);
        setConfirming(false);
      });
  };

  return (
    <Box direction="Column" gap="100">
      <Box alignItems="Center" gap="300">
        <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
          <Text size="T300" truncate>
            {getConnectionName(connection, index)}
          </Text>
          {lastSeen && (
            <Text size="T200" priority="300">
              {t('mindroomUi.local-mindroom.localMindroom.lastSeen', {
                time: formatLocalTimestamp(lastSeen),
              })}
            </Text>
          )}
        </Box>
        {connectionId && (
          <Box gap="200" alignItems="Center" shrink="No">
            {confirming ? (
              <>
                <Button
                  size="300"
                  variant="Critical"
                  fill="Solid"
                  radii="300"
                  disabled={revoking}
                  onClick={revoke}
                >
                  <Text size="B300">
                    {t('mindroomUi.local-mindroom.localMindroom.confirmRevoke')}
                  </Text>
                </Button>
                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  radii="300"
                  disabled={revoking}
                  onClick={() => setConfirming(false)}
                >
                  <Text size="B300">{t('mindroomUi.local-mindroom.localMindroom.cancel')}</Text>
                </Button>
              </>
            ) : (
              <Button
                size="300"
                variant="Critical"
                fill="Soft"
                radii="300"
                onClick={() => setConfirming(true)}
              >
                <Text size="B300">{t('mindroomUi.local-mindroom.localMindroom.revoke')}</Text>
              </Button>
            )}
          </Box>
        )}
      </Box>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.local-mindroom.localMindroom.requestFailed')}
        </Text>
      )}
    </Box>
  );
}

function LinkedInstallations({ provisioningBaseUrl }: { provisioningBaseUrl: string }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [state, setState] = useState<Connections>({ status: 'loading' });

  // Provisioning requests carry a short-lived OpenID token, never the account's access token.
  const openIdToken = useCallback(async () => (await mx.getOpenIdToken()).access_token, [mx]);

  const load = useCallback(async () => {
    try {
      const { connections } = await getLocalMindroomConnections(
        await openIdToken(),
        provisioningBaseUrl
      );
      setState({
        status: 'ready',
        connections: (connections ?? []).filter((connection) => !isConnectionRevoked(connection)),
      });
    } catch (error) {
      setState({
        status: 'error',
        message: getLocalMindroomErrorMessage(
          error,
          t('mindroomUi.local-mindroom.localMindroom.requestFailed')
        ),
      });
    }
  }, [openIdToken, provisioningBaseUrl, t]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (connectionId: string) => {
    await revokeLocalMindroomConnection(connectionId, await openIdToken(), provisioningBaseUrl);
    await load();
  };

  if (state.status === 'loading') return <Spinner size="200" variant="Secondary" />;
  if (state.status === 'error') {
    return (
      <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
        {state.message}
      </Text>
    );
  }
  if (state.connections.length === 0) {
    return <SettingTile title={t('mindroomUi.local-mindroom.localMindroom.noConnections')} />;
  }
  return (
    <>
      {state.connections.map((connection, index) => (
        <ConnectionRow
          key={getConnectionId(connection) ?? index}
          connection={connection}
          index={index}
          onRevoke={revoke}
        />
      ))}
    </>
  );
}

type LocalMindroomProps = {
  requestClose: () => void;
  /** Called when the page navigates away, so the settings dialog can close. */
  onNavigate: () => void;
};

/**
 * Settings → Local MindRoom: connect a MindRoom running on the user's own machine (it shows a
 * code to enter here), and see or revoke the installations already linked to this account.
 */
export function LocalMindroom({ requestClose, onNavigate }: LocalMindroomProps) {



  const provisioningOverrideUrl = useClientConfig().sidebar?.mindRoomProvisioningUrl;
  const { provisioningBaseUrl, canAuthenticate } = resolveMindroomProvisioningRequest({
    sessionHomeserverUrl: mx.getHomeserverUrl(),
    provisioningOverrideUrl,
    accessToken: mx.getAccessToken() ?? undefined,
  });

  return (
    <SettingsPageFrame
      title={t('mindroomUi.local-mindroom.localMindroom.connectLocalMindroom')}
      requestClose={requestClose}
    >
      <Box direction="Column" gap="100">
















          <Box direction="Column" gap="200">
            <Text size="T300">{t('mindroomUi.local-mindroom.localMindroom.enterCode')}</Text>
            <PairCodeForm
              onSubmit={(code) => {
                navigate(getConnectPath(code));
                onNavigate();
              }}
            />
          </Box>
        </SequenceCard>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400">{t('mindroomUi.local-mindroom.localMindroom.linkedTitle')}</Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          {canAuthenticate && provisioningBaseUrl ? (
            <LinkedInstallations provisioningBaseUrl={provisioningBaseUrl} />
          ) : (
            <SettingTile
              title={t('mindroomUi.local-mindroom.localMindroom.linkedUnavailable', {
                host: provisioningBaseUrl ? hostOf(provisioningBaseUrl) : '',
              })}
            />
          )}
        </SequenceCard>
      </Box>
    </SettingsPageFrame>
  );
}
