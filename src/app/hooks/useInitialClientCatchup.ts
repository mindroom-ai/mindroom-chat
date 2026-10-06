import { SyncState, type MatrixClient } from 'matrix-js-sdk';
import { useCallback, useEffect, useState } from 'react';
import { useSyncState } from './useSyncState';

export type ClientSyncStateData = {
  current: SyncState | null | undefined;
  // The SDK's flag: the last /sync still had to-device messages, so it polls again at once.
  catchingUp?: boolean;
};

const readClientSyncStateData = (mx: MatrixClient | undefined): ClientSyncStateData => ({
  current: mx?.getSyncState?.() ?? null,
  catchingUp: mx?.getSyncStateData?.()?.catchingUp,
});

// The client has caught up once a sync reports nothing left to catch up on.
export const isInitialClientCatchupInProgress = ({
  current,
  catchingUp,
}: ClientSyncStateData): boolean =>
  current == null ||
  current === SyncState.Prepared ||
  current === SyncState.Catchup ||
  (current === SyncState.Syncing && catchingUp === true);

/** The client's sync state, starting from the state it is already in. */
export const useClientSyncStateData = (mx: MatrixClient | undefined): ClientSyncStateData => {
  const [stateData, setStateData] = useState(() => readClientSyncStateData(mx));

  useEffect(() => {
    setStateData(readClientSyncStateData(mx));
  }, [mx]);

  useSyncState(
    mx,
    useCallback((current, _previous, data) => {
      setStateData((state) =>
        state.current === current && state.catchingUp === data?.catchingUp
          ? state
          : { current, catchingUp: data?.catchingUp }
      );
    }, [])
  );

  return stateData;
};

export const useInitialClientCatchup = (mx: MatrixClient | undefined): boolean =>
  isInitialClientCatchupInProgress(useClientSyncStateData(mx));
