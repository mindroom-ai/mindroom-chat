import { useEffect, useState } from 'react';
import { Box, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { ClientEvent, SyncState, type MatrixClient, type SyncStateData } from 'matrix-js-sdk';
import { ContainerColor } from '../ui/styles/ContainerColor.css';
import { useHomeserverUnreachable } from '../matrix/client/homeserverReachability';
import { useCloudflareAccessSignInRequired } from '../native/cloudflareAccess';
import { hostOf } from '../lib/httpUrl';

type SyncStatusProps = {
  mx: MatrixClient;
};

type SyncSnapshot = {
  current: SyncState | null;
  catchingUp: boolean;
};

/** Startup (Prepared) and reconnects (Catchup) catch up until a sync says the SDK has. */
const nextSnapshot = (
  previous: SyncSnapshot,
  current: SyncState | null,
  data?: SyncStateData
): SyncSnapshot => {
  if (current === SyncState.Prepared || current === SyncState.Catchup) {
    return { current, catchingUp: true };
  }
  if (current === SyncState.Syncing && previous.catchingUp) {
    return { current, catchingUp: data?.catchingUp === true };
  }
  return { current, catchingUp: current === SyncState.Syncing ? false : previous.catchingUp };
};

const readInitialSnapshot = (mx: MatrixClient): SyncSnapshot => {
  const current = typeof mx.getSyncState === 'function' ? mx.getSyncState() : null;
  const data =
    typeof mx.getSyncStateData === 'function' ? mx.getSyncStateData() ?? undefined : undefined;
  return nextSnapshot({ current: null, catchingUp: false }, current, data);
};

/**
 * A thin banner for a lost connection, a needed organization sign-in, or catching up. The client
 * root keeps it in a polite live region, which stays mounted while the banner comes and goes.
 */
export function SyncStatus({ mx }: SyncStatusProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() => readInitialSnapshot(mx));
  const unreachable = useHomeserverUnreachable(mx);
  const baseUrl = mx.getHomeserverUrl();
  const signInRequired = useCloudflareAccessSignInRequired(baseUrl);

  useEffect(() => {
    const handleSync = (current: SyncState, _previous: SyncState | null, data?: SyncStateData) => {
      setSnapshot((previous) => nextSnapshot(previous, current, data));
    };
    mx.on(ClientEvent.Sync, handleSync);
    return () => {
      mx.removeListener(ClientEvent.Sync, handleSync);
    };
  }, [mx]);

  const syncFailed = snapshot.current === SyncState.Error;
  let message: string | undefined;
  let critical = false;
  if (signInRequired && syncFailed) {
    message = t('mindroomUi.native.cloudflareAccess.signInRequired', { value1: hostOf(baseUrl) });
    critical = true;
  } else if (unreachable || syncFailed) {
    message =
      snapshot.current === SyncState.Reconnecting
        ? t('sharedUi.syncStatus.connectionLostReconnecting')
        : t('sharedUi.syncStatus.connectionLost');
    critical = true;
  } else if (snapshot.catchingUp) {
    message = t('sharedUi.syncStatus.catchingUp');
  }

  if (!message) return null;

  return (
    <Box
      data-testid="client-sync-status"
      className={ContainerColor({ variant: critical ? 'Critical' : 'Success' })}
      justifyContent="Center"
      alignItems="Center"
      style={{ padding: `${config.space.S100} 0` }}
    >
      <Text size="L400">{message}</Text>
    </Box>
  );
}
