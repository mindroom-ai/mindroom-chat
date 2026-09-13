import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, Scroll, Spinner, Text, color } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { copyToClipboard } from '../../../utils/dom';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SequenceCardStyle } from '../styles.css';
import {
  LocalMindroomConnection,
  getLocalMindroomConnections,
  getLocalMindroomErrorMessage,
  getLocalMindroomPairStatus,
  issueLocalMindroomPairCode,
  revokeLocalMindroomConnection,
} from './api';
import {
  formatLocalTimestamp,
  getConnectionCreatedAt,
  getConnectionId,
  getConnectionLastSeenAt,
  getConnectionName,
  getMindroomDocsUrl,
  getMindroomPairingCommand,
  getPairingSecondsRemaining,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
} from './mindroom';

type LocalMindroomProps = {
  requestClose: () => void;
};

type PairStatus = 'pending' | 'connected' | 'expired';

type PairSession = {
  pairCode: string;
  expiresAt: string;
  pollIntervalSeconds: number;
};

export function LocalMindroom({ requestClose }: LocalMindroomProps) {
  const mx = useMatrixClient();
  const { sidebar } = useClientConfig();
  const docsUrl = getMindroomDocsUrl(sidebar?.mindRoomUrl);
  const sessionHomeserverUrl = mx.getHomeserverUrl();
  const sessionAccessToken = mx.getAccessToken() ?? undefined;
  const provisioningRequest = resolveMindroomProvisioningRequest({
    sessionHomeserverUrl,
    provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
    accessToken: sessionAccessToken,
  });
  const provisioningUrl = provisioningRequest.provisioningBaseUrl;
  const browserAccessToken = provisioningRequest.accessToken;

  const [connections, setConnections] = useState<LocalMindroomConnection[] | undefined>();
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string>();

  const [pairSession, setPairSession] = useState<PairSession>();
  const [pairStatus, setPairStatus] = useState<PairStatus>();
  const [pairConnection, setPairConnection] = useState<LocalMindroomConnection>();
  const [pairError, setPairError] = useState<string>();
  const [startingPair, setStartingPair] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [copiedCommand, setCopiedCommand] = useState(false);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();
  const [revokeError, setRevokeError] = useState<string>();

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    setConnectionsError(undefined);
    try {
      const result = await getLocalMindroomConnections(fetch, browserAccessToken, provisioningUrl);
      setConnections(result.connections.filter((connection) => !isConnectionRevoked(connection)));
    } catch (error) {
      setConnectionsError(getLocalMindroomErrorMessage(error));
    } finally {
      setLoadingConnections(false);
    }
  }, [browserAccessToken, provisioningUrl]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (!pairSession) return undefined;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [pairSession]);

  const secondsRemaining = useMemo(() => {
    if (!pairSession) return 0;
    return getPairingSecondsRemaining(pairSession.expiresAt, nowMs);
  }, [pairSession, nowMs]);

  useEffect(() => {
    if (!pairSession || pairStatus !== 'pending') return;
    if (secondsRemaining <= 0) {
      setPairStatus('expired');
    }
  }, [pairSession, pairStatus, secondsRemaining]);

  useEffect(() => {
    if (!pairSession || pairStatus !== 'pending') return undefined;

    let cancelled = false;
    const pollIntervalMs = Math.max(1, pairSession.pollIntervalSeconds) * 1000;

    const poll = async () => {
      try {
        const result = await getLocalMindroomPairStatus(
          pairSession.pairCode,
          fetch,
          browserAccessToken,
          provisioningUrl
        );
        if (cancelled) return;

        if (result.status === 'pending') {
          setPairStatus('pending');
          return;
        }

        if (result.status === 'expired') {
          setPairStatus('expired');
          return;
        }

        setPairStatus('connected');
        setPairConnection(result.connection);
        loadConnections().catch(() => undefined);
      } catch (error) {
        if (cancelled) return;
        setPairError(getLocalMindroomErrorMessage(error));
      }
    };

    poll();
    const intervalId = window.setInterval(() => {
      poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pairSession, pairStatus, loadConnections, browserAccessToken, provisioningUrl]);

  const handleStartPair = useCallback(async () => {
    setStartingPair(true);
    setPairError(undefined);
    setRevokeError(undefined);
    setConfirmRevokeId(undefined);
    setPairConnection(undefined);

    try {
      const result = await issueLocalMindroomPairCode(fetch, browserAccessToken, provisioningUrl);
      setPairSession({
        pairCode: result.pair_code,
        expiresAt: result.expires_at,
        pollIntervalSeconds: result.poll_interval_seconds,
      });
      setPairStatus('pending');
      setNowMs(Date.now());
      setCopiedCommand(false);
    } catch (error) {
      setPairError(getLocalMindroomErrorMessage(error));
    } finally {
      setStartingPair(false);
    }
  }, [browserAccessToken, provisioningUrl]);

  const handleCopyCommand = useCallback(() => {
    if (!pairSession) return;
    copyToClipboard(getMindroomPairingCommand(pairSession.pairCode));
    setCopiedCommand(true);
    window.setTimeout(() => setCopiedCommand(false), 1600);
  }, [pairSession]);

  const handleRevokeConnection = useCallback(
    async (connectionId: string) => {
      setRevokingId(connectionId);
      setRevokeError(undefined);

      try {
        await revokeLocalMindroomConnection(
          connectionId,
          fetch,
          browserAccessToken,
          provisioningUrl
        );
        setConfirmRevokeId(undefined);
        await loadConnections();
      } catch (error) {
        setRevokeError(getLocalMindroomErrorMessage(error));
      } finally {
        setRevokingId(undefined);
      }
    },
    [loadConnections, browserAccessToken, provisioningUrl]
  );

  const hasConnections = (connections?.length ?? 0) > 0;
  const pairingCommand = pairSession ? getMindroomPairingCommand(pairSession.pairCode) : '';
  const showGenerateNewCode = !pairSession || pairStatus === 'expired';
  let pairStatusLabel = `${secondsRemaining}s`;
  if (pairStatus === 'connected') pairStatusLabel = 'Connected';
  else if (pairStatus === 'expired') pairStatusLabel = 'Expired';

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Local MindRoom
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <Box direction="Column" gap="100">
                <Text size="L400">Connect Local MindRoom</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    title="Pair this chat account with your local MindRoom process"
                    description="Generate a one-time code, run the command locally, then wait for the connection confirmation."
                  />

                  {provisioningRequest.warning && (
                    <Text size="T200" style={{ color: color.Warning.Main }}>
                      {provisioningRequest.warning}
                    </Text>
                  )}

                  {pairSession && (
                    <Box direction="Column" gap="300">
                      <SettingTile
                        title="Pair code"
                        description={pairSession.pairCode}
                        after={
                          <Text size="B300" style={{ color: color.Secondary.Main }}>
                            {pairStatusLabel}
                          </Text>
                        }
                      />
                      <SettingTile
                        title="Command"
                        description={
                          <code style={{ fontSize: '0.85em', wordBreak: 'break-word' }}>{pairingCommand}</code>
                        }
                        after={
                          <Button
                            size="300"
                            variant="Secondary"
                            fill="Soft"
                            outlined
                            radii="300"
                            onClick={handleCopyCommand}
                          >
                            <Text size="B300">{copiedCommand ? 'Copied' : 'Copy Command'}</Text>
                          </Button>
                        }
                      />
                    </Box>
                  )}

                  {pairStatus === 'pending' && (
                    <Text size="T200" priority="300">
                      Waiting for local connection. Run the command above on your machine.
                    </Text>
                  )}

                  {pairStatus === 'connected' && (
                    <Box direction="Column" gap="100">
                      <Text size="T200" style={{ color: color.Success.Main }}>
                        Local MindRoom connected successfully.
                      </Text>
                      {pairConnection && (
                        <Text size="T200" priority="300">
                          {getConnectionName(pairConnection, 0)} | Created:{' '}
                          {formatLocalTimestamp(getConnectionCreatedAt(pairConnection))} | Last seen:{' '}
                          {formatLocalTimestamp(getConnectionLastSeenAt(pairConnection))}
                        </Text>
                      )}
                    </Box>
                  )}

                  {pairStatus === 'expired' && (
                    <Text size="T200" style={{ color: color.Warning.Main }}>
                      Pair code expired. Generate a new code to continue.
                    </Text>
                  )}

                  {pairError && (
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      {pairError}
                    </Text>
                  )}

                  <Box gap="200" wrap="Wrap">
                    <Button
                      size="300"
                      variant="Primary"
                      radii="300"
                      onClick={handleStartPair}
                      disabled={startingPair || pairStatus === 'pending'}
                      before={startingPair && <Spinner variant="Primary" fill="Solid" size="200" />}
                    >
                      <Text size="B300">
                        {showGenerateNewCode ? 'Generate Pair Code' : 'Generate New Code'}
                      </Text>
                    </Button>
                    <Button
                      size="300"
                      variant="Secondary"
                      fill="Soft"
                      outlined
                      radii="300"
                      onClick={() => window.open(docsUrl, '_blank', 'noopener,noreferrer')}
                    >
                      <Text size="B300">MindRoom Docs</Text>
                    </Button>
                  </Box>
                </SequenceCard>
              </Box>

              <Box direction="Column" gap="100">
                <Text size="L400">Linked Installations</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="300"
                >
                  {loadingConnections && (
                    <Box alignItems="Center" gap="200">
                      <Spinner variant="Secondary" fill="Soft" size="200" />
                      <Text size="T200" priority="300">
                        Loading linked installations...
                      </Text>
                    </Box>
                  )}

                  {!loadingConnections && connectionsError && (
                    <Box direction="Column" gap="200">
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {connectionsError}
                      </Text>
                      <Button
                        size="300"
                        variant="Secondary"
                        fill="Soft"
                        outlined
                        radii="300"
                        onClick={loadConnections}
                      >
                        <Text size="B300">Try Again</Text>
                      </Button>
                    </Box>
                  )}

                  {!loadingConnections && !connectionsError && !hasConnections && (
                    <Text size="T200" priority="300">
                      No linked local MindRoom installations yet.
                    </Text>
                  )}

                  {connections?.map((connection, index) => {
                    const connectionId = getConnectionId(connection);
                    const isRevoking = connectionId !== undefined && revokingId === connectionId;
                    const isConfirming = connectionId !== undefined && confirmRevokeId === connectionId;

                    return (
                      <SequenceCard
                        key={connectionId ?? `connection-item-${index}`}
                        variant="Surface"
                        direction="Column"
                        gap="200"
                        style={{ padding: '12px' }}
                      >
                        <SettingTile
                          title={getConnectionName(connection, index)}
                          description={
                            <>
                              <div>
                                Created: {formatLocalTimestamp(getConnectionCreatedAt(connection))}
                              </div>
                              <div>
                                Last seen: {formatLocalTimestamp(getConnectionLastSeenAt(connection))}
                              </div>
                            </>
                          }
                        />

                        {connectionId && (
                          <Box gap="200" wrap="Wrap">
                            {!isConfirming && (
                              <Button
                                size="300"
                                variant="Critical"
                                fill="Soft"
                                outlined
                                radii="300"
                                onClick={() => setConfirmRevokeId(connectionId)}
                              >
                                <Text size="B300">Revoke</Text>
                              </Button>
                            )}

                            {isConfirming && (
                              <>
                                <Button
                                  size="300"
                                  variant="Critical"
                                  radii="300"
                                  onClick={() => {
                                    handleRevokeConnection(connectionId);
                                  }}
                                  disabled={isRevoking}
                                  before={
                                    isRevoking && <Spinner variant="Critical" fill="Solid" size="200" />
                                  }
                                >
                                  <Text size="B300">Confirm Revoke</Text>
                                </Button>
                                <Button
                                  size="300"
                                  variant="Secondary"
                                  fill="Soft"
                                  outlined
                                  radii="300"
                                  onClick={() => setConfirmRevokeId(undefined)}
                                  disabled={isRevoking}
                                >
                                  <Text size="B300">Cancel</Text>
                                </Button>
                              </>
                            )}
                          </Box>
                        )}
                      </SequenceCard>
                    );
                  })}

                  {revokeError && (
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      {revokeError}
                    </Text>
                  )}
                </SequenceCard>
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
